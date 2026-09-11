import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';
import { NotificationService } from './notification.service.js';
import { generatePayslipPdf } from '../utils/pdfGenerator.js';
import { numberToWords } from '../utils/numberToWords.js';

export class CompensationPayrollService {
  /**
   * Helper to verify a person belongs to the given tenant.
   */
  async verifyPersonInTenant(tenantId, personId) {
    const res = await db.query(
      'SELECT id, first_name, last_name, email, organization_id FROM persons WHERE id = $1 AND organization_id = $2',
      [personId, tenantId]
    );
    if (res.rows.length === 0) {
      throw new AppError('Employee not found in this organization', 404);
    }
    return res.rows[0];
  }

  // =========================================================================
  // 1. COMPENSATION & SALARY STRUCTURE
  // =========================================================================

  /**
   * Get complete compensation overview for an employee (Base salary, active components, recent increments).
   */
  async getEmployeeCompensation(tenantId, personId) {
    const person = await this.verifyPersonInTenant(tenantId, personId);

    // 1. Base salary structure
    const structRes = await db.query(
      `SELECT * FROM salary_structures
       WHERE person_id = $1 AND is_active = true
       ORDER BY effective_from DESC, created_at DESC
       LIMIT 1`,
      [personId]
    );
    const salaryStructure = structRes.rows[0] || null;

    // 2. Active salary components
    const compRes = await db.query(
      `SELECT * FROM salary_components
       WHERE person_id = $1 AND is_active = true
       ORDER BY created_at ASC`,
      [personId]
    );
    const salaryComponents = compRes.rows;

    // 3. Salary increment history
    const incRes = await db.query(
      `SELECT si.*, 
              pb.first_name as proposed_by_first_name, pb.last_name as proposed_by_last_name,
              rb.first_name as reviewed_by_first_name, rb.last_name as reviewed_by_last_name
       FROM salary_increments si
       LEFT JOIN persons pb ON pb.id = si.proposed_by
       LEFT JOIN persons rb ON rb.id = si.reviewed_by
       WHERE si.person_id = $1
       ORDER BY si.created_at DESC`,
      [personId]
    );
    const salaryIncrements = incRes.rows;

    // 4. Calculate total gross monthly compensation
    const baseSalary = salaryStructure ? Number(salaryStructure.base_salary) : 0;
    const allowances = salaryStructure ? Number(salaryStructure.allowances) : 0;
    const totalComponentsAmount = salaryComponents.reduce(
      (sum, c) => sum + Number(c.calculated_amount || 0),
      0
    );
    const totalMonthlyCompensation = baseSalary + allowances + totalComponentsAmount;

    return {
      person: {
        id: person.id,
        first_name: person.first_name,
        last_name: person.last_name,
        email: person.email,
      },
      salary_structure: salaryStructure,
      salary_components: salaryComponents,
      salary_increments: salaryIncrements,
      summary: {
        base_salary: baseSalary,
        allowances: allowances,
        components_total: totalComponentsAmount,
        total_monthly_compensation: totalMonthlyCompensation,
      },
    };
  }

  /**
   * Upsert base salary structure for an employee.
   */
  async upsertSalaryStructure(tenantId, personId, data) {
    await this.verifyPersonInTenant(tenantId, personId);

    const { base_salary, allowances, effective_from } = data;
    if (base_salary === undefined || Number(base_salary) < 0) {
      throw new AppError('base_salary must be a non-negative number', 400);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Deactivate existing active structures
      await client.query(
        `UPDATE salary_structures SET is_active = false, updated_at = NOW()
         WHERE person_id = $1 AND is_active = true`,
        [personId]
      );

      // Insert new structure
      const insertRes = await client.query(
        `INSERT INTO salary_structures (person_id, base_salary, allowances, effective_from, is_active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING *`,
        [
          personId,
          Number(base_salary),
          Number(allowances || 0),
          effective_from || new Date().toISOString().split('T')[0],
        ]
      );

      await client.query('COMMIT');

      // Recalculate percentage-based salary components if any exist
      await this.recalculateSalaryComponents(personId, Number(base_salary), Number(allowances || 0));

      return insertRes.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // =========================================================================
  // 2. SALARY COMPONENTS
  // =========================================================================

  /**
   * Get salary components for an employee.
   */
  async getSalaryComponents(tenantId, personId) {
    await this.verifyPersonInTenant(tenantId, personId);
    const res = await db.query(
      `SELECT * FROM salary_components WHERE person_id = $1 ORDER BY created_at DESC`,
      [personId]
    );
    return res.rows;
  }

  /**
   * Add a salary component for an employee.
   */
  async addSalaryComponent(tenantId, personId, createdBy, data) {
    await this.verifyPersonInTenant(tenantId, personId);

    const {
      component_type,
      calculation_type,
      percentage_base,
      configured_value,
      effective_from,
    } = data;

    const validComponentTypes = [
      'BASIC',
      'HRA',
      'STANDARD_ALLOWANCE',
      'PERFORMANCE_BONUS',
      'LTA',
      'FIXED_ALLOWANCE',
      'STOCK_EQUITY',
    ];

    if (!component_type || !validComponentTypes.includes(component_type.toUpperCase())) {
      throw new AppError(`component_type must be one of: ${validComponentTypes.join(', ')}`, 400);
    }
    if (!calculation_type || !['FIXED', 'PERCENTAGE'].includes(calculation_type.toUpperCase())) {
      throw new AppError("calculation_type must be 'FIXED' or 'PERCENTAGE'", 400);
    }
    if (
      calculation_type.toUpperCase() === 'PERCENTAGE' &&
      (!percentage_base || !['WAGE', 'BASIC'].includes(percentage_base.toUpperCase()))
    ) {
      throw new AppError("percentage_base must be 'WAGE' or 'BASIC' for PERCENTAGE calculation_type", 400);
    }
    if (configured_value === undefined || Number(configured_value) < 0) {
      throw new AppError('configured_value must be a non-negative number', 400);
    }

    // Get current base salary structure to compute percentage
    const structRes = await db.query(
      `SELECT base_salary, allowances FROM salary_structures WHERE person_id = $1 AND is_active = true LIMIT 1`,
      [personId]
    );
    const baseSalary = structRes.rows[0] ? Number(structRes.rows[0].base_salary) : 0;
    const allowances = structRes.rows[0] ? Number(structRes.rows[0].allowances) : 0;

    let calculatedAmount = 0;
    if (calculation_type.toUpperCase() === 'FIXED') {
      calculatedAmount = Number(configured_value);
    } else {
      const baseAmount = percentage_base.toUpperCase() === 'BASIC' ? baseSalary : baseSalary + allowances;
      calculatedAmount = (Number(configured_value) / 100) * baseAmount;
    }

    const res = await db.query(
      `INSERT INTO salary_components
         (person_id, component_type, calculation_type, percentage_base, configured_value, calculated_amount, is_active, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
       RETURNING *`,
      [
        personId,
        component_type.toUpperCase(),
        calculation_type.toUpperCase(),
        percentage_base ? percentage_base.toUpperCase() : null,
        Number(configured_value),
        calculatedAmount,
        effective_from || new Date().toISOString().split('T')[0],
        createdBy,
      ]
    );

    // Audit log
    await db.query(
      `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
       VALUES ($1, 'salary_component', $2, 'CREATE', $3::jsonb, $4, 'Salary component added')`,
      [tenantId, res.rows[0].id, JSON.stringify(res.rows[0]), createdBy]
    );

    return res.rows[0];
  }

  /**
   * Update a salary component.
   */
  async updateSalaryComponent(tenantId, componentId, updatedBy, data) {
    const compCheck = await db.query(
      `SELECT sc.*, p.organization_id
       FROM salary_components sc
       JOIN persons p ON p.id = sc.person_id
       WHERE sc.id = $1 AND p.organization_id = $2`,
      [componentId, tenantId]
    );
    if (compCheck.rows.length === 0) {
      throw new AppError('Salary component not found', 404);
    }
    const existing = compCheck.rows[0];

    const configured_value = data.configured_value !== undefined ? Number(data.configured_value) : Number(existing.configured_value);
    const calculation_type = data.calculation_type ? data.calculation_type.toUpperCase() : existing.calculation_type;
    const percentage_base = data.percentage_base !== undefined ? (data.percentage_base ? data.percentage_base.toUpperCase() : null) : existing.percentage_base;
    const is_active = data.is_active !== undefined ? Boolean(data.is_active) : existing.is_active;
    const effective_from = data.effective_from || existing.effective_from;

    // Get current base salary structure to recalculate
    const structRes = await db.query(
      `SELECT base_salary, allowances FROM salary_structures WHERE person_id = $1 AND is_active = true LIMIT 1`,
      [existing.person_id]
    );
    const baseSalary = structRes.rows[0] ? Number(structRes.rows[0].base_salary) : 0;
    const allowances = structRes.rows[0] ? Number(structRes.rows[0].allowances) : 0;

    let calculatedAmount = 0;
    if (calculation_type === 'FIXED') {
      calculatedAmount = configured_value;
    } else if (percentage_base) {
      const baseAmount = percentage_base === 'BASIC' ? baseSalary : baseSalary + allowances;
      calculatedAmount = (configured_value / 100) * baseAmount;
    }

    const res = await db.query(
      `UPDATE salary_components
       SET calculation_type = $1,
           percentage_base  = $2,
           configured_value = $3,
           calculated_amount = $4,
           is_active        = $5,
           effective_from   = $6,
           updated_at       = NOW()
       WHERE id = $7
       RETURNING *`,
      [calculation_type, percentage_base, configured_value, calculatedAmount, is_active, effective_from, componentId]
    );

    return res.rows[0];
  }

  /**
   * Delete / Deactivate a salary component.
   */
  async deleteSalaryComponent(tenantId, componentId) {
    const compCheck = await db.query(
      `SELECT sc.id
       FROM salary_components sc
       JOIN persons p ON p.id = sc.person_id
       WHERE sc.id = $1 AND p.organization_id = $2`,
      [componentId, tenantId]
    );
    if (compCheck.rows.length === 0) {
      throw new AppError('Salary component not found', 404);
    }

    await db.query(
      `UPDATE salary_components SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [componentId]
    );
    return { message: 'Salary component deactivated successfully' };
  }

  /**
   * Helper to recalculate percentage-based salary components when base salary changes.
   */
  async recalculateSalaryComponents(personId, baseSalary, allowances) {
    const compRes = await db.query(
      `SELECT * FROM salary_components WHERE person_id = $1 AND is_active = true AND calculation_type = 'PERCENTAGE'`,
      [personId]
    );

    for (const comp of compRes.rows) {
      const baseAmount = comp.percentage_base === 'BASIC' ? baseSalary : baseSalary + allowances;
      const newCalculatedAmount = (Number(comp.configured_value) / 100) * baseAmount;
      await db.query(
        `UPDATE salary_components SET calculated_amount = $1, updated_at = NOW() WHERE id = $2`,
        [newCalculatedAmount, comp.id]
      );
    }
  }

  // =========================================================================
  // 3. SALARY INCREMENT WORKFLOW
  // =========================================================================

  /**
   * Get list of salary increments.
   */
  async getIncrements(tenantId, filters = {}) {
    const { person_id, status, proposed_by } = filters;
    const params = [tenantId];
    const conditions = ['p.organization_id = $1'];

    if (person_id) {
      params.push(person_id);
      conditions.push(`si.person_id = $${params.length}`);
    }
    if (status) {
      params.push(status.toUpperCase());
      conditions.push(`si.status = $${params.length}`);
    }
    if (proposed_by) {
      params.push(proposed_by);
      conditions.push(`si.proposed_by = $${params.length}`);
    }

    const res = await db.query(
      `SELECT si.*,
              p.first_name, p.last_name, p.email, p.employee_id,
              pb.first_name as proposed_by_first_name, pb.last_name as proposed_by_last_name,
              rb.first_name as reviewed_by_first_name, rb.last_name as reviewed_by_last_name
       FROM salary_increments si
       JOIN persons p ON p.id = si.person_id
       LEFT JOIN persons pb ON pb.id = si.proposed_by
       LEFT JOIN persons rb ON rb.id = si.reviewed_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY si.created_at DESC`,
      params
    );
    return res.rows;
  }

  /**
   * Propose a salary increment for an employee.
   */
  async proposeIncrement(tenantId, proposedBy, data) {
    const { person_id, proposed_salary, effective_from, reason } = data;
    await this.verifyPersonInTenant(tenantId, person_id);

    if (proposed_salary === undefined || Number(proposed_salary) < 0) {
      throw new AppError('proposed_salary must be a non-negative number', 400);
    }

    // Get current base salary
    const structRes = await db.query(
      `SELECT base_salary FROM salary_structures WHERE person_id = $1 AND is_active = true LIMIT 1`,
      [person_id]
    );
    const currentSalary = structRes.rows[0] ? Number(structRes.rows[0].base_salary) : 0;
    const proposedSalaryNum = Number(proposed_salary);

    let incrementPercentage = 0;
    if (currentSalary > 0) {
      incrementPercentage = ((proposedSalaryNum - currentSalary) / currentSalary) * 100;
    }

    const res = await db.query(
      `INSERT INTO salary_increments
         (person_id, current_salary, proposed_salary, increment_percentage, reason, status, proposed_by, effective_from)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7)
       RETURNING *`,
      [
        person_id,
        currentSalary,
        proposedSalaryNum,
        incrementPercentage.toFixed(2),
        reason || null,
        proposedBy,
        effective_from || new Date().toISOString().split('T')[0],
      ]
    );

    // Audit log
    await db.query(
      `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
       VALUES ($1, 'salary_increment', $2, 'PROPOSE', $3::jsonb, $4, 'Salary increment proposed')`,
      [tenantId, res.rows[0].id, JSON.stringify(res.rows[0]), proposedBy]
    );

    // Notify employee of proposed compensation revision
    await NotificationService.createNotification(db, {
      tenantId,
      personId: person_id,
      type: 'INCREMENT_PROPOSED',
      title: 'Salary Revision Proposed',
      message: 'A salary revision proposal has been submitted for review.',
      entityType: 'salary_increment',
      entityId: res.rows[0].id,
      metadata: {
        increment_id: res.rows[0].id,
        effective_from: effective_from || null,
      },
    });

    return res.rows[0];
  }

  /**
   * Review a salary increment (Approve, Reject, Cancel).
   */
  async reviewIncrement(tenantId, incrementId, reviewerId, data) {
    const { status, reviewer_comment } = data;
    const validStatuses = ['APPROVED', 'REJECTED', 'CANCELLED'];
    if (!status || !validStatuses.includes(status.toUpperCase())) {
      throw new AppError(`status must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const incCheck = await db.query(
      `SELECT si.*, p.organization_id
       FROM salary_increments si
       JOIN persons p ON p.id = si.person_id
       WHERE si.id = $1 AND p.organization_id = $2`,
      [incrementId, tenantId]
    );
    if (incCheck.rows.length === 0) {
      throw new AppError('Salary increment request not found', 404);
    }
    const increment = incCheck.rows[0];

    if (increment.status !== 'PENDING') {
      throw new AppError(`Increment request is already in '${increment.status}' state`, 400);
    }

    const targetStatus = status.toUpperCase();

    const res = await db.query(
      `UPDATE salary_increments
       SET status           = $1,
           reviewed_by      = $2,
           reviewer_comment = $3,
           reviewed_at      = NOW(),
           updated_at       = NOW()
       WHERE id = $4
       RETURNING *`,
      [targetStatus, reviewerId, reviewer_comment || null, incrementId]
    );

    // If APPROVED, update the base salary structure automatically
    if (targetStatus === 'APPROVED') {
      await this.upsertSalaryStructure(tenantId, increment.person_id, {
        base_salary: increment.proposed_salary,
        allowances: 0,
        effective_from: increment.effective_from || new Date().toISOString().split('T')[0],
      });
    }

    // Audit log
    await db.query(
      `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
       VALUES ($1, 'salary_increment', $2, $3, $4::jsonb, $5, $6)`,
      [
        tenantId,
        'salary_increment',
        incrementId,
        targetStatus,
        JSON.stringify(res.rows[0]),
        reviewerId,
        `Salary increment ${targetStatus.toLowerCase()}`,
      ]
    );

    // Notify employee of revision outcome
    const isApproved = targetStatus === 'APPROVED';
    await NotificationService.createNotification(db, {
      tenantId,
      personId: increment.person_id,
      type: isApproved ? 'INCREMENT_APPROVED' : 'INCREMENT_REJECTED',
      title: isApproved ? 'Salary Revision Approved' : 'Salary Revision Update',
      message: isApproved
        ? 'Your salary revision proposal has been approved and activated.'
        : `Your salary revision proposal was reviewed (${targetStatus.toLowerCase()}).`,
      entityType: 'salary_increment',
      entityId: incrementId,
      metadata: {
        increment_id: incrementId,
        status: targetStatus,
      },
    });

    return res.rows[0];
  }

  // =========================================================================
  // 4. PAYROLL & PAYSLIPS
  // =========================================================================

  /**
   * Get payroll records for the organization or a specific employee.
   */
  async getPayrollRecords(tenantId, filters = {}) {
    const { person_id, month, year, status } = filters;
    const params = [tenantId];
    const conditions = ['p.organization_id = $1'];

    if (person_id) {
      params.push(person_id);
      conditions.push(`pr.person_id = $${params.length}`);
    }
    if (month) {
      params.push(parseInt(month, 10));
      conditions.push(`pr.month = $${params.length}`);
    }
    if (year) {
      params.push(parseInt(year, 10));
      conditions.push(`pr.year = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`pr.status = $${params.length}`);
    }

    const res = await db.query(
      `SELECT pr.*, p.first_name, p.last_name, p.email, p.employee_id
       FROM payroll pr
       JOIN persons p ON p.id = pr.person_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY pr.year DESC, pr.month DESC, pr.created_at DESC`,
      params
    );
    return res.rows;
  }

  /**
   * Get a single detailed payroll record by ID.
   */
  async getPayrollRecordById(tenantId, payrollId) {
    const res = await db.query(
      `SELECT pr.*, p.first_name, p.last_name, p.email, p.employee_id
       FROM payroll pr
       JOIN persons p ON p.id = pr.person_id
       WHERE pr.id = $1 AND p.organization_id = $2`,
      [payrollId, tenantId]
    );
    if (res.rows.length === 0) {
      throw new AppError('Payroll record not found', 404);
    }
    return res.rows[0];
  }

  /**
   * Generate or calculate monthly payroll for an employee automatically.
   * Strictly accepts ONLY { person_id, month, year }.
   */
  async generateMonthlyPayroll(tenantId, generatedBy, data) {
    const {
      person_id,
      month,
      year,
    } = data;

    await this.verifyPersonInTenant(tenantId, person_id);

    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);

    if (!monthNum || monthNum < 1 || monthNum > 12) throw new AppError('month must be between 1 and 12', 400);
    if (!yearNum || yearNum < 2000) throw new AppError('year must be a valid year', 400);

    // 1. Calculate exact month start and end dates (YYYY-MM-DD)
    const monthStartStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
    const totalDaysInMonth = new Date(yearNum, monthNum, 0).getDate();
    const monthEndStr = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(totalDaysInMonth).padStart(2, '0')}`;

    // 2. Query company holidays in this month range
    const holRes = await db.query(
      `SELECT holiday_date FROM holidays
       WHERE organization_id = $1 AND is_active = true
         AND holiday_date >= $2 AND holiday_date <= $3`,
      [tenantId, monthStartStr, monthEndStr]
    );
    const holidayCount = holRes.rows.length;
    const totalWorkingDays = Math.max(0, totalDaysInMonth - holidayCount);

    // 3. Query actual attendance within month range
    const attRes = await db.query(
      `SELECT work_date, status, punctuality_status FROM attendance
       WHERE person_id = $1
         AND work_date >= $2 AND work_date <= $3`,
      [person_id, monthStartStr, monthEndStr]
    );

    let attendancePresentDays = 0;
    attRes.rows.forEach(r => {
      if (r.status === 'HALF_DAY' || r.punctuality_status === 'HALF_DAY') {
        attendancePresentDays += 0.5;
      } else {
        attendancePresentDays += 1;
      }
    });

    // 4. Query approved leave requests that OVERLAP with month range [monthStartStr, monthEndStr]
    // Overlap condition: start_date <= monthEndStr AND end_date >= monthStartStr
    const leaveRes = await db.query(
      `SELECT lr.start_date, lr.end_date, lt.is_paid
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.person_id = $1 AND lr.status = 'Approved'
         AND lr.start_date <= $2
         AND lr.end_date >= $3`,
      [person_id, monthEndStr, monthStartStr]
    );

    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;

    const mStart = new Date(`${monthStartStr}T00:00:00Z`).getTime();
    const mEnd = new Date(`${monthEndStr}T00:00:00Z`).getTime();

    const toDateStr = (d) => {
      if (!d) return '';
      if (typeof d === 'string') return d.substring(0, 10);
      if (d instanceof Date) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
      return String(d).substring(0, 10);
    };

    leaveRes.rows.forEach(lr => {
      const lStartStr = toDateStr(lr.start_date);
      const lEndStr = toDateStr(lr.end_date);

      const lStart = new Date(`${lStartStr}T00:00:00Z`).getTime();
      const lEnd = new Date(`${lEndStr}T00:00:00Z`).getTime();

      const overlapStart = Math.max(lStart, mStart);
      const overlapEnd = Math.min(lEnd, mEnd);

      if (overlapEnd >= overlapStart) {
        const daysInMonth = Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
        if (lr.is_paid) {
          paidLeaveDays += daysInMonth;
        } else {
          unpaidLeaveDays += daysInMonth;
        }
      }
    });

    // Compute actual payable days strictly from attendance + paid leaves + holidays
    const calculatedPayableDays = attendancePresentDays + paidLeaveDays + holidayCount;
    const payableDays = Math.min(totalWorkingDays, Math.max(0, calculatedPayableDays));

    // 5. Fetch salary structure & components
    const structRes = await db.query(
      `SELECT base_salary, allowances FROM salary_structures WHERE person_id = $1 AND is_active = true LIMIT 1`,
      [person_id]
    );
    const baseSalary = structRes.rows[0] ? Number(structRes.rows[0].base_salary) : 0;

    const compRes = await db.query(
      `SELECT * FROM salary_components WHERE person_id = $1 AND is_active = true`,
      [person_id]
    );

    let basicSalary = baseSalary;
    let hra = 0;
    let standardAllowance = 0;
    let performanceBonus = 0;
    let leaveTravelAllowance = 0;
    let fixedAllowance = structRes.rows[0] ? Number(structRes.rows[0].allowances) : 0;
    let stockEquity = 0;

    let pfValFromComp = null;
    let ptValFromComp = null;
    let tdsValFromComp = null;
    let otherDedFromComp = null;

    const componentBreakdown = {};

    compRes.rows.forEach((comp) => {
      const amt = Number(comp.calculated_amount || 0);
      const cType = comp.component_type ? comp.component_type.toUpperCase() : '';
      componentBreakdown[cType] = amt;

      switch (cType) {
        case 'BASIC': basicSalary = amt; break;
        case 'HRA': hra = amt; break;
        case 'STANDARD_ALLOWANCE': standardAllowance = amt; break;
        case 'PERFORMANCE_BONUS': performanceBonus = amt; break;
        case 'LTA': leaveTravelAllowance = amt; break;
        case 'FIXED_ALLOWANCE': fixedAllowance = amt; break;
        case 'STOCK_EQUITY': stockEquity = amt; break;

        case 'PF':
        case 'PROVIDENT_FUND':
          pfValFromComp = amt;
          break;
        case 'PT':
        case 'PROFESSIONAL_TAX':
          ptValFromComp = amt;
          break;
        case 'TDS':
        case 'INCOME_TAX':
        case 'TAX':
          tdsValFromComp = amt;
          break;
        case 'OTHER_DEDUCTION':
        case 'OTHER_DEDUCTIONS':
        case 'DEDUCTION':
          otherDedFromComp = (otherDedFromComp || 0) + amt;
          break;
      }
    });

    // Prorate earnings based on actual payable days / total working days
    const prorationFactor = totalWorkingDays > 0 ? (payableDays / totalWorkingDays) : 0;
    basicSalary = Math.round(basicSalary * prorationFactor * 100) / 100;
    hra = Math.round(hra * prorationFactor * 100) / 100;
    standardAllowance = Math.round(standardAllowance * prorationFactor * 100) / 100;
    performanceBonus = Math.round(performanceBonus * prorationFactor * 100) / 100;
    leaveTravelAllowance = Math.round(leaveTravelAllowance * prorationFactor * 100) / 100;
    fixedAllowance = Math.round(fixedAllowance * prorationFactor * 100) / 100;
    stockEquity = Math.round(stockEquity * prorationFactor * 100) / 100;

    const totalEarnings = basicSalary + hra + standardAllowance + performanceBonus + leaveTravelAllowance + fixedAllowance + stockEquity;

    // 6. Query salary_deductions table if present for this month
    const dedDbRes = await db.query(
      `SELECT name, amount FROM salary_deductions
       WHERE person_id = $1
         AND deduction_date >= $2 AND deduction_date <= $3`,
      [person_id, monthStartStr, monthEndStr]
    );

    let pfFromDb = null;
    let ptFromDb = null;
    let tdsFromDb = null;
    let otherDedFromDb = 0;

    dedDbRes.rows.forEach(d => {
      const name = (d.name || '').toUpperCase();
      const amt = Number(d.amount || 0);
      if (name.includes('PF') || name.includes('PROVIDENT')) {
        pfFromDb = (pfFromDb || 0) + amt;
      } else if (name.includes('PT') || name.includes('PROFESSIONAL TAX')) {
        ptFromDb = (ptFromDb || 0) + amt;
      } else if (name.includes('TDS') || name.includes('TAX')) {
        tdsFromDb = (tdsFromDb || 0) + amt;
      } else {
        otherDedFromDb += amt;
      }
    });

    const pfVal = Number(pfValFromComp ?? pfFromDb ?? 0);
    const ptVal = Number(ptValFromComp ?? ptFromDb ?? 0);
    const tdsVal = Number(tdsValFromComp ?? tdsFromDb ?? 0);
    const otherDedVal = Number(otherDedFromComp ?? otherDedFromDb ?? 0);

    const totalDeductions = pfVal + ptVal + tdsVal + otherDedVal;
    const netSalary = Math.max(0, totalEarnings - totalDeductions);
    const amountInWordsStr = numberToWords(netSalary);

    // UPSERT into payroll table
    const res = await db.query(
      `INSERT INTO payroll (
         person_id, month, year, total_earnings, total_deductions, net_salary, status,
         basic_salary, hra, standard_allowance, performance_bonus, leave_travel_allowance,
         fixed_allowance, stock_equity, tds, provident_fund, professional_tax, other_deductions,
         working_days, paid_days, component_breakdown, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'Pending',
         $7, $8, $9, $10, $11,
         $12, $13, $14, $15, $16, $17,
         $18, $19, $20::jsonb, NOW()
       )
       ON CONFLICT (person_id, month, year) DO UPDATE SET
         total_earnings         = EXCLUDED.total_earnings,
         total_deductions       = EXCLUDED.total_deductions,
         net_salary             = EXCLUDED.net_salary,
         basic_salary           = EXCLUDED.basic_salary,
         hra                    = EXCLUDED.hra,
         standard_allowance     = EXCLUDED.standard_allowance,
         performance_bonus      = EXCLUDED.performance_bonus,
         leave_travel_allowance = EXCLUDED.leave_travel_allowance,
         fixed_allowance        = EXCLUDED.fixed_allowance,
         stock_equity           = EXCLUDED.stock_equity,
         tds                    = EXCLUDED.tds,
         provident_fund         = EXCLUDED.provident_fund,
         professional_tax       = EXCLUDED.professional_tax,
         other_deductions       = EXCLUDED.other_deductions,
         working_days           = EXCLUDED.working_days,
         paid_days              = EXCLUDED.paid_days,
         component_breakdown    = EXCLUDED.component_breakdown,
         updated_at             = NOW()
       RETURNING *`,
      [
        person_id, monthNum, yearNum, totalEarnings, totalDeductions, netSalary,
        basicSalary, hra, standardAllowance, performanceBonus, leaveTravelAllowance,
        fixedAllowance, stockEquity, tdsVal, pfVal, ptVal, otherDedVal,
        totalWorkingDays, payableDays, JSON.stringify(componentBreakdown),
      ]
    );

    const payrollRecord = res.rows[0];

    // Auto-upsert entry in payslips table
    const fileName = `payslip_${person_id}_${yearNum}_${monthNum}.pdf`;
    const fileUrl = `/api/payroll/payslips/${payrollRecord.id}/pdf`;

    await db.query(
      `INSERT INTO payslips (
         person_id, payroll_id, month, year, file_name, file_url, file_type, file_size, uploaded_by
       ) VALUES ($1, $2, $3, $4, $5, $6, 'application/pdf', NULL, $7)
       ON CONFLICT (person_id, month, year) DO UPDATE SET
         payroll_id   = EXCLUDED.payroll_id,
         file_name    = EXCLUDED.file_name,
         file_url     = EXCLUDED.file_url,
         uploaded_by  = EXCLUDED.uploaded_by,
         generated_at = NOW()`,
      [person_id, payrollRecord.id, monthNum, yearNum, fileName, fileUrl, generatedBy]
    );

    return {
      ...payrollRecord,
      amount_in_words: amountInWordsStr,
    };
  }

  /**
   * Update status of a payroll record.
   */
  async updatePayrollStatus(tenantId, payrollId, updatedBy, data) {
    const { status, payment_date, payment_reference } = data;
    const validStatuses = ['Pending', 'Processed', 'Paid'];
    if (!status || !validStatuses.includes(status)) {
      throw new AppError(`status must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const payrollCheck = await db.query(
      `SELECT pr.id, pr.person_id, pr.month, pr.year FROM payroll pr
       JOIN persons p ON p.id = pr.person_id
       WHERE pr.id = $1 AND p.organization_id = $2`,
      [payrollId, tenantId]
    );
    if (payrollCheck.rows.length === 0) {
      throw new AppError('Payroll record not found', 404);
    }

    const res = await db.query(
      `UPDATE payroll
       SET status            = $1,
           payment_date      = COALESCE($2, payment_date),
           payment_reference = COALESCE($3, payment_reference),
           updated_at        = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, payment_date || null, payment_reference || null, payrollId]
    );

    // If marked Paid, notify employee
    if (status === 'Paid') {
      const prData = payrollCheck.rows[0];
      await NotificationService.createNotification(db, {
        tenantId,
        personId: prData.person_id,
        type: 'SALARY_CREDITED',
        title: 'Salary Payout Processed',
        message: `Your payroll payout for ${prData.month}/${prData.year} has been processed.`,
        entityType: 'payroll',
        entityId: payrollId,
        metadata: {
          payroll_id: payrollId,
          month: prData.month,
          year: prData.year,
        },
      });
    }

    return res.rows[0];
  }

  // =========================================================================
  // 5. PAYSLIPS
  // =========================================================================

  /**
   * Get payslips for an employee.
   */
  async getPayslips(tenantId, personId, year = null) {
    await this.verifyPersonInTenant(tenantId, personId);
    const params = [personId];
    let query = `SELECT * FROM payslips WHERE person_id = $1`;

    if (year) {
      params.push(parseInt(year, 10));
      query += ` AND year = $2`;
    }
    query += ` ORDER BY year DESC, month DESC`;

    const res = await db.query(query, params);
    return res.rows;
  }

  /**
   * Get detailed payslip payload (Company, Employee, Bank/Tax, Earnings, Deductions, Net Pay).
   */
  async getPayslipDetail(tenantId, identifier, requestingPersonId, userRoles = []) {
    let payslipRes = await db.query(
      `SELECT ps.id AS payslip_id, ps.payroll_id, ps.month, ps.year, ps.file_name, ps.file_url,
              pr.total_earnings, pr.total_deductions, pr.net_salary, pr.basic_salary, pr.hra,
              pr.standard_allowance, pr.performance_bonus, pr.leave_travel_allowance, pr.fixed_allowance,
              pr.stock_equity, pr.tds, pr.provident_fund, pr.professional_tax, pr.other_deductions,
              pr.working_days, pr.paid_days, pr.payment_date, pr.payment_reference, pr.component_breakdown,
              p.id AS person_id, p.first_name, p.last_name, p.email, p.employee_id, p.workday_id,
              p.bank_name, p.account_number, p.ifsc_code, p.pan_number,
              o.name AS org_name, o.metadata AS org_metadata,
              pos.title AS position_title, d.name AS department_name
       FROM payslips ps
       JOIN payroll pr ON pr.id = ps.payroll_id
       JOIN persons p ON p.id = ps.person_id
       JOIN organizations o ON o.id = p.organization_id
       LEFT JOIN position_assignments pa ON pa.person_id = p.id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= current_date)
       LEFT JOIN positions pos ON pos.id = pa.position_id
       LEFT JOIN departments d ON d.id = pos.department_id
       WHERE (ps.id = $1 OR ps.payroll_id = $1) AND p.organization_id = $2`,
      [identifier, tenantId]
    );

    if (payslipRes.rows.length === 0) {
      // Fallback search in payroll table directly
      const prRes = await db.query(
        `SELECT pr.id AS payroll_id, pr.month, pr.year,
                pr.total_earnings, pr.total_deductions, pr.net_salary, pr.basic_salary, pr.hra,
                pr.standard_allowance, pr.performance_bonus, pr.leave_travel_allowance, pr.fixed_allowance,
                pr.stock_equity, pr.tds, pr.provident_fund, pr.professional_tax, pr.other_deductions,
                pr.working_days, pr.paid_days, pr.payment_date, pr.payment_reference, pr.component_breakdown,
                p.id AS person_id, p.first_name, p.last_name, p.email, p.employee_id, p.workday_id,
                p.bank_name, p.account_number, p.ifsc_code, p.pan_number,
                o.name AS org_name, o.metadata AS org_metadata,
                pos.title AS position_title, d.name AS department_name
         FROM payroll pr
         JOIN persons p ON p.id = pr.person_id
         JOIN organizations o ON o.id = p.organization_id
         LEFT JOIN position_assignments pa ON pa.person_id = p.id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= current_date)
         LEFT JOIN positions pos ON pos.id = pa.position_id
         LEFT JOIN departments d ON d.id = pos.department_id
         WHERE pr.id = $1 AND p.organization_id = $2`,
        [identifier, tenantId]
      );

      if (prRes.rows.length === 0) {
        throw new AppError('Payslip or payroll record not found', 404);
      }
      payslipRes = prRes;
    }

    const row = payslipRes.rows[0];

    // RBAC & IDOR check
    const isOrgAdmin = userRoles.includes('Org Admin') || userRoles.includes('HR Manager') || userRoles.includes('CEO');
    if (!isOrgAdmin && row.person_id !== requestingPersonId) {
      throw new AppError('Forbidden: You do not have permission to access another employee\'s payslip', 403);
    }

    let maskedAccount = null;
    if (row.account_number) {
      const rawAcc = String(row.account_number).trim();
      maskedAccount = rawAcc.length > 4 ? `XXXX XXXX ${rawAcc.slice(-4)}` : rawAcc;
    }

    const earnings = [
      { name: 'Basic Salary', amount: Number(row.basic_salary || 0) },
      { name: 'HRA', amount: Number(row.hra || 0) },
      { name: 'Standard Allowance', amount: Number(row.standard_allowance || 0) },
      { name: 'Performance Bonus', amount: Number(row.performance_bonus || 0) },
      { name: 'Leave Travel Allowance (LTA)', amount: Number(row.leave_travel_allowance || 0) },
      { name: 'Fixed Allowance', amount: Number(row.fixed_allowance || 0) },
      { name: 'Stock / Equity', amount: Number(row.stock_equity || 0) },
    ].filter(e => e.amount > 0);

    const deductions = [
      { name: 'Provident Fund (PF)', amount: Number(row.provident_fund || 0) },
      { name: 'Professional Tax (PT)', amount: Number(row.professional_tax || 0) },
      { name: 'Tax Deducted at Source (TDS)', amount: Number(row.tds || 0) },
      { name: 'Other Deductions', amount: Number(row.other_deductions || 0) },
    ].filter(d => d.amount > 0);

    const netSalary = Number(row.net_salary || 0);
    const amountInWordsStr = numberToWords(netSalary);
    const orgMeta = row.org_metadata || {};

    return {
      payslip_id: row.payslip_id || null,
      payroll_id: row.payroll_id,
      organization: {
        name: row.org_name || 'Haazri',
        email: orgMeta.email || null,
        phone: orgMeta.phone || null,
        address: orgMeta.address || null,
        logo_url: orgMeta.logo_url || null,
      },
      employee: {
        id: row.person_id,
        full_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
        email: row.email,
        employee_id: row.employee_id,
        workday_id: row.workday_id,
        designation: row.position_title || null,
        department: row.department_name || null,
      },
      bank: {
        bank_name: row.bank_name || null,
        masked_account_number: maskedAccount,
        ifsc_code: row.ifsc_code || null,
        pan_number: row.pan_number || null,
      },
      payroll: {
        month: row.month,
        year: row.year,
        payment_date: row.payment_date ? new Date(row.payment_date).toISOString().split('T')[0] : null,
        working_days: row.working_days,
        paid_days: row.paid_days,
        total_earnings: Number(row.total_earnings || 0),
        total_deductions: Number(row.total_deductions || 0),
        net_salary: netSalary,
        amount_in_words: amountInWordsStr,
      },
      earnings,
      deductions,
    };
  }

  /**
   * Generates payslip PDF buffer for download.
   */
  async generatePayslipPdfBuffer(tenantId, identifier, requestingPersonId, userRoles = []) {
    const detail = await this.getPayslipDetail(tenantId, identifier, requestingPersonId, userRoles);
    const pdfBuffer = await generatePayslipPdf(detail);
    const fileName = `payslip_${detail.employee.employee_id || detail.employee.id}_${detail.payroll.year}_${detail.payroll.month}.pdf`;
    return { pdfBuffer, fileName, detail };
  }

  /**
   * Create/Upload payslip PDF metadata.
   */
  async createPayslip(tenantId, uploadedBy, data) {
    const { person_id, payroll_id, month, year, file_name, file_url, file_size } = data;
    await this.verifyPersonInTenant(tenantId, person_id);

    if (!month || !year || !file_name || !file_url) {
      throw new AppError('person_id, month, year, file_name, and file_url are required', 400);
    }

    const res = await db.query(
      `INSERT INTO payslips (
         person_id, payroll_id, month, year, file_name, file_url, file_type, file_size, uploaded_by
       ) VALUES ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8)
       ON CONFLICT (person_id, month, year) DO UPDATE SET
         payroll_id   = EXCLUDED.payroll_id,
         file_name    = EXCLUDED.file_name,
         file_url     = EXCLUDED.file_url,
         file_size    = EXCLUDED.file_size,
         uploaded_by  = EXCLUDED.uploaded_by,
         generated_at = NOW()
       RETURNING *`,
      [person_id, payroll_id || null, month, year, file_name, file_url, file_size || null, uploadedBy]
    );

    // Notify employee of payslip availability
    await NotificationService.createNotification(db, {
      tenantId,
      personId: person_id,
      type: 'PAYSLIP_AVAILABLE',
      title: 'Payslip Document Available',
      message: `Your payslip document for ${month}/${year} is available to view and download.`,
      entityType: 'payslip',
      entityId: res.rows[0].id,
      metadata: {
        payslip_id: res.rows[0].id,
        month,
        year,
      },
    });

    return res.rows[0];
  }
}
