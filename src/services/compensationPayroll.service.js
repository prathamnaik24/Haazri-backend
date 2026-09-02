import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';

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
   * Generate or calculate monthly payroll for an employee.
   */
  async generateMonthlyPayroll(tenantId, generatedBy, data) {
    const {
      person_id,
      month,
      year,
      working_days,
      paid_days,
      tds,
      provident_fund,
      professional_tax,
      other_deductions,
    } = data;

    await this.verifyPersonInTenant(tenantId, person_id);

    if (!month || month < 1 || month > 12) throw new AppError('month must be between 1 and 12', 400);
    if (!year || year < 2000) throw new AppError('year must be a valid year', 400);

    // 1. Fetch current active salary structure
    const structRes = await db.query(
      `SELECT base_salary, allowances FROM salary_structures WHERE person_id = $1 AND is_active = true LIMIT 1`,
      [person_id]
    );
    const baseSalary = structRes.rows[0] ? Number(structRes.rows[0].base_salary) : 0;

    // 2. Fetch active salary components
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

    const componentBreakdown = {};

    compRes.rows.forEach((comp) => {
      const amt = Number(comp.calculated_amount || 0);
      componentBreakdown[comp.component_type] = amt;

      switch (comp.component_type) {
        case 'BASIC': basicSalary = amt; break;
        case 'HRA': hra = amt; break;
        case 'STANDARD_ALLOWANCE': standardAllowance = amt; break;
        case 'PERFORMANCE_BONUS': performanceBonus = amt; break;
        case 'LTA': leaveTravelAllowance = amt; break;
        case 'FIXED_ALLOWANCE': fixedAllowance = amt; break;
        case 'STOCK_EQUITY': stockEquity = amt; break;
      }
    });

    const totalEarnings = basicSalary + hra + standardAllowance + performanceBonus + leaveTravelAllowance + fixedAllowance + stockEquity;
    
    const tdsVal = Number(tds || 0);
    const pfVal = Number(provident_fund || 0);
    const ptVal = Number(professional_tax || 0);
    const otherDedVal = Number(other_deductions || 0);

    const totalDeductions = tdsVal + pfVal + ptVal + otherDedVal;
    const netSalary = totalEarnings - totalDeductions;

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
        person_id, month, year, totalEarnings, totalDeductions, netSalary,
        basicSalary, hra, standardAllowance, performanceBonus, leaveTravelAllowance,
        fixedAllowance, stockEquity, tdsVal, pfVal, ptVal, otherDedVal,
        working_days || null, paid_days || null, JSON.stringify(componentBreakdown),
      ]
    );

    return res.rows[0];
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
      `SELECT pr.id FROM payroll pr
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

    return res.rows[0];
  }
}
