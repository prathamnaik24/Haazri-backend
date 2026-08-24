import { db } from '../../db/index.js';
import { AppError } from '../../middlewares/errorHandler.js';

export const ORG_TEMPLATES = {
  corporate: {
    id: 'corporate',
    name: 'Corporate & Technology Enterprise',
    description: 'Executive leadership (CEO/CTO/COO/CFO), Engineering teams, HR, Finance, and Operations.',
    icon: '🏢',
    structure: {
      title: 'Chief Executive Officer (CEO)',
      children: [
        {
          title: 'Chief Technology Officer (CTO)',
          children: [
            {
              title: 'Engineering Manager',
              children: [
                { title: 'Senior Software Engineer' },
                { title: 'Software Engineer' },
                { title: 'QA & Test Engineer' },
              ],
            },
            {
              title: 'DevOps & Cloud Architect',
              children: [{ title: 'System Administrator' }],
            },
          ],
        },
        {
          title: 'Chief Operating Officer (COO)',
          children: [
            {
              title: 'Operations Manager',
              children: [{ title: 'Logistics Coordinator' }, { title: 'Office Administrator' }],
            },
          ],
        },
        {
          title: 'Chief Financial Officer (CFO)',
          children: [
            {
              title: 'Finance Director',
              children: [{ title: 'Senior Accountant' }, { title: 'Payroll Specialist' }],
            },
          ],
        },
        {
          title: 'Head of Human Resources',
          children: [
            { title: 'Talent Acquisition Lead' },
            { title: 'HR & People Specialist' },
          ],
        },
      ],
    },
  },
  school: {
    id: 'school',
    name: 'School / College / University',
    description: 'Principal, Vice Principals, Academic Department Heads, Teachers/Professors, and Support Staff.',
    icon: '🏫',
    structure: {
      title: 'Principal / Dean',
      children: [
        {
          title: 'Vice Principal (Academics)',
          children: [
            {
              title: 'Head of Science Department',
              children: [
                { title: 'Senior Science Teacher' },
                { title: 'Assistant Science Teacher' },
                { title: 'Laboratory Assistant' },
              ],
            },
            {
              title: 'Head of Mathematics Department',
              children: [{ title: 'Senior Math Teacher' }, { title: 'Assistant Math Teacher' }],
            },
            {
              title: 'Head of Languages & Humanities',
              children: [{ title: 'English Teacher' }, { title: 'Social Studies Teacher' }],
            },
          ],
        },
        {
          title: 'Vice Principal (Student Affairs)',
          children: [
            { title: 'Physical Education Director' },
            { title: 'Chief Librarian', children: [{ title: 'Assistant Librarian' }] },
            { title: 'Student Counselor' },
          ],
        },
        {
          title: 'Administrative Officer',
          children: [
            { title: 'Admissions Coordinator' },
            { title: 'Accountant & Fee Clerk' },
            { title: 'Campus Facility Manager' },
          ],
        },
      ],
    },
  },
  healthcare: {
    id: 'healthcare',
    name: 'Hospital / Healthcare Facility',
    description: 'Medical Director, Clinical Department Heads, Specialists, Doctors, Nursing, and Hospital Admin.',
    icon: '🏥',
    structure: {
      title: 'Chief Medical Officer / Medical Director',
      children: [
        {
          title: 'Head of Emergency Medicine',
          children: [
            { title: 'ER Consultant Physician' },
            { title: 'Resident Medical Officer (RMO)' },
            { title: 'Emergency EMT / Paramedic' },
          ],
        },
        {
          title: 'Head of General Surgery & Inpatient',
          children: [
            { title: 'Attending Surgeon' },
            { title: 'Junior Doctor / Intern' },
          ],
        },
        {
          title: 'Chief Nursing Officer (Head Nurse)',
          children: [
            { title: 'ICU Charge Nurse' },
            { title: 'Ward Staff Nurse' },
            { title: 'Nursing Assistant' },
          ],
        },
        {
          title: 'Head of Diagnostics & Laboratory',
          children: [
            { title: 'Senior Pathologist' },
            { title: 'Radiology / X-Ray Technician' },
            { title: 'Laboratory Technician' },
          ],
        },
        {
          title: 'Hospital Administrator',
          children: [
            { title: 'Front Desk & Patient Relations' },
            { title: 'Medical Records Officer' },
            { title: 'Pharmacy Supervisor' },
          ],
        },
      ],
    },
  },
  startup: {
    id: 'startup',
    name: 'Startup / Agile Product Team',
    description: 'Fast-paced hierarchy for Founders, Tech Leads, Growth Marketers, and Product Designers.',
    icon: '🚀',
    structure: {
      title: 'Founder & CEO',
      children: [
        {
          title: 'Co-Founder & CTO',
          children: [
            {
              title: 'Lead Full-Stack Developer',
              children: [{ title: 'Frontend Developer' }, { title: 'Backend Developer' }],
            },
            { title: 'UI/UX Product Designer' },
          ],
        },
        {
          title: 'Head of Product & Growth',
          children: [
            { title: 'Growth Marketer' },
            { title: 'Customer Success Specialist' },
          ],
        },
        {
          title: 'Operations & Finance Lead',
          children: [{ title: 'Business Operations Associate' }],
        },
      ],
    },
  },
  retail: {
    id: 'retail',
    name: 'Retail Store / Supermarket Chain',
    description: 'Store Managers, Floor Supervisors, Cashier Leads, Inventory Control, and Customer Care.',
    icon: '🛍️',
    structure: {
      title: 'Store General Manager',
      children: [
        {
          title: 'Assistant Store Manager',
          children: [
            {
              title: 'Floor Supervisor (Sales)',
              children: [{ title: 'Senior Sales Associate' }, { title: 'Sales Associate' }],
            },
            {
              title: 'Head Cashier / Checkout Supervisor',
              children: [{ title: 'POS Cashier' }],
            },
            {
              title: 'Customer Service Lead',
              children: [{ title: 'Customer Help Desk Associate' }],
            },
          ],
        },
        {
          title: 'Inventory & Warehouse Lead',
          children: [
            { title: 'Stock & Receiving Specialist' },
            { title: 'Loss Prevention & Security' },
          ],
        },
      ],
    },
  },
  ngo: {
    id: 'ngo',
    name: 'NGO / Non-Profit Foundation',
    description: 'Executive Director, Program Managers, Field Officers, Community Liaisons, and Fundraisers.',
    icon: '🤝',
    structure: {
      title: 'Executive Director',
      children: [
        {
          title: 'Director of Programs & Impact',
          children: [
            {
              title: 'Community Outreach Project Manager',
              children: [
                { title: 'Field Coordinator' },
                { title: 'Community Liaison Officer' },
                { title: 'Volunteer Coordinator' },
              ],
            },
            { title: 'Monitoring & Evaluation Lead' },
          ],
        },
        {
          title: 'Director of Fundraising & Partnerships',
          children: [
            { title: 'Donor Relations Manager' },
            { title: 'Grants & Proposal Specialist' },
          ],
        },
        {
          title: 'Finance & Compliance Officer',
          children: [{ title: 'Accounts & Audit Assistant' }],
        },
      ],
    },
  },
};

export class OrgStructureService {
  static getTemplatesList() {
    return Object.values(ORG_TEMPLATES).map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      structure: t.structure,
    }));
  }

  static async getDepartments(orgId) {
    const res = await db.query('SELECT * FROM departments WHERE organization_id = $1', [orgId]);
    return res.rows;
  }

  static async getPositionsTree(orgId) {
    const res = await db.query(`
      SELECT 
        pos.id, 
        pos.parent_id, 
        pos.title, 
        pos.path, 
        pos.is_active,
        per.first_name, 
        per.last_name
      FROM positions pos
      LEFT JOIN position_assignments pa ON pos.id = pa.position_id AND pa.is_primary = true
      LEFT JOIN persons per ON pa.person_id = per.id
      WHERE pos.organization_id = $1
      ORDER BY pos.path
    `, [orgId]);
    return res.rows;
  }

  static async applyTemplate(orgId, { templateKey, replaceExisting = false }) {
    const template = ORG_TEMPLATES[templateKey];
    if (!template) {
      throw new AppError(`Invalid template key: "${templateKey}". Options: ${Object.keys(ORG_TEMPLATES).join(', ')}`, 400);
    }

    const orgRes = await db.query('SELECT slug FROM organizations WHERE id = $1', [orgId]);
    if (orgRes.rows.length === 0) {
      throw new AppError('Organization not found', 404);
    }
    const orgSlug = orgRes.rows[0].slug.replace(/-/g, '_');

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      if (replaceExisting) {
        const check = await client.query(
          `SELECT COUNT(*) FROM position_assignments pa
           JOIN positions p ON p.id = pa.position_id
           WHERE p.organization_id = $1 AND (pa.end_date IS NULL OR pa.end_date >= current_date)`,
          [orgId]
        );
        if (parseInt(check.rows[0].count, 10) > 0) {
          throw new AppError('Cannot replace hierarchy because active employees are already assigned to positions. Please reassign them first.', 409);
        }
        await client.query('DELETE FROM positions WHERE organization_id = $1', [orgId]);
      }

      const insertNode = async (node, parentId, parentPath) => {
        const slug = node.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
        let path = parentPath ? `${parentPath}.${slug}` : `${orgSlug}.${slug}`;

        const existing = await client.query(
          'SELECT id FROM positions WHERE organization_id = $1 AND path::text = $2',
          [orgId, path]
        );
        if (existing.rows.length > 0) {
          path = `${path}_${Math.floor(Math.random() * 9000 + 1000)}`;
        }

        const res = await client.query(
          `INSERT INTO positions (organization_id, title, parent_id, path, is_active)
           VALUES ($1, $2, $3, $4::ltree, true)
           RETURNING id, path::text as path`,
          [orgId, node.title, parentId || null, path]
        );
        const insertedId = res.rows[0].id;
        const insertedPath = res.rows[0].path;

        if (node.children && Array.isArray(node.children)) {
          for (const child of node.children) {
            await insertNode(child, insertedId, insertedPath);
          }
        }
      };

      await insertNode(template.structure, null, null);

      await client.query('COMMIT');
      return { success: true, template: template.name };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async createPosition(orgId, { title, parent_id }) {
    if (!title || title.trim() === '') {
      throw new AppError('Position title is required', 400);
    }

    const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    let path;
    if (parent_id) {
      const parentRes = await db.query(
        'SELECT path FROM positions WHERE id = $1 AND organization_id = $2',
        [parent_id, orgId]
      );
      if (parentRes.rows.length === 0) {
        throw new AppError('Parent position not found in this organization', 404);
      }
      const parentPath = parentRes.rows[0].path;
      path = `${parentPath}.${slug}`;
    } else {
      const orgRes = await db.query('SELECT slug FROM organizations WHERE id = $1', [orgId]);
      const orgSlug = orgRes.rows[0].slug.replace(/-/g, '_');
      path = `${orgSlug}.${slug}`;
    }

    const existing = await db.query(
      'SELECT id FROM positions WHERE organization_id = $1 AND path::text LIKE $2',
      [orgId, `${path}%`]
    );
    if (existing.rows.length > 0) {
      path = `${path}_${existing.rows.length}`;
    }

    const res = await db.query(
      `INSERT INTO positions (organization_id, title, parent_id, path, is_active)
       VALUES ($1, $2, $3, $4::ltree, true)
       RETURNING id, title, parent_id, path::text AS path, is_active`,
      [orgId, title.trim(), parent_id || null, path]
    );

    return res.rows[0];
  }

  static async updatePosition(orgId, positionId, { title }) {
    if (!title || title.trim() === '') {
      throw new AppError('Position title is required', 400);
    }

    const res = await db.query(
      `UPDATE positions SET title = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND organization_id = $3
       RETURNING id, title, parent_id, path::text AS path, is_active`,
      [title.trim(), positionId, orgId]
    );

    if (res.rows.length === 0) {
      throw new AppError('Position not found', 404);
    }
    return res.rows[0];
  }

  static async deletePosition(orgId, positionId) {
    const posRes = await db.query(
      'SELECT path FROM positions WHERE id = $1 AND organization_id = $2',
      [positionId, orgId]
    );
    if (posRes.rows.length === 0) {
      throw new AppError('Position not found', 404);
    }

    const posPath = posRes.rows[0].path;

    // Check if position or any child in subtree has active employee assignments
    const assignmentCheck = await db.query(
      `SELECT COUNT(*) FROM position_assignments pa
       JOIN positions p ON p.id = pa.position_id
       WHERE p.organization_id = $1 
         AND p.path <@ $2::ltree 
         AND pa.is_primary = true 
         AND (pa.end_date IS NULL OR pa.end_date > current_date)`,
      [orgId, posPath]
    );

    if (parseInt(assignmentCheck.rows[0].count, 10) > 0) {
      throw new AppError('Cannot delete a position that has active employee assignments. Please reassign employees first.', 409);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Delete historical/ended position assignments for subtree
      await client.query(
        `DELETE FROM position_assignments 
         WHERE position_id IN (SELECT id FROM positions WHERE organization_id = $1 AND path <@ $2::ltree)`,
        [orgId, posPath]
      );

      // Delete position and all child positions in subtree
      await client.query(
        `DELETE FROM positions WHERE organization_id = $1 AND path <@ $2::ltree`,
        [orgId, posPath]
      );

      await client.query('COMMIT');
      return { deleted: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
