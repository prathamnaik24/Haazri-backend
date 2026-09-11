import { CompensationPayrollService } from '../services/compensationPayroll.service.js';

const service = new CompensationPayrollService();

/** GET /api/payroll/me — Employee self-view payroll history */
export const getMyPayrollHistory = async (req, res, next) => {
  try {
    const result = await service.getPayrollRecords(req.currentTenantId, {
      person_id: req.user.person_id,
      year: req.query.year,
      month: req.query.month,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/payroll/records — Admin/HR view all payroll records */
export const getPayrollRecords = async (req, res, next) => {
  try {
    const result = await service.getPayrollRecords(req.currentTenantId, {
      person_id: req.query.person_id,
      month: req.query.month,
      year: req.query.year,
      status: req.query.status,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/payroll/records/:id — Get single payroll detail */
export const getPayrollRecordById = async (req, res, next) => {
  try {
    const result = await service.getPayrollRecordById(req.currentTenantId, req.params.id);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** POST /api/payroll/generate — Generate/compute monthly payroll automatically */
export const generatePayroll = async (req, res, next) => {
  try {
    const result = await service.generateMonthlyPayroll(
      req.currentTenantId,
      req.user.person_id,
      req.body
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** PATCH /api/payroll/records/:id/status — Update payroll status */
export const updatePayrollStatus = async (req, res, next) => {
  try {
    const result = await service.updatePayrollStatus(
      req.currentTenantId,
      req.params.id,
      req.user.person_id,
      req.body
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/payroll/payslips/me — Employee self-view payslips */
export const getMyPayslips = async (req, res, next) => {
  try {
    const result = await service.getPayslips(
      req.currentTenantId,
      req.user.person_id,
      req.query.year
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/payroll/payslips/person/:id — Admin/HR view payslips */
export const getPersonPayslips = async (req, res, next) => {
  try {
    const result = await service.getPayslips(
      req.currentTenantId,
      req.params.id,
      req.query.year
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/payroll/payslips/:id — View single payslip detail JSON */
export const getPayslipDetail = async (req, res, next) => {
  try {
    const result = await service.getPayslipDetail(
      req.currentTenantId,
      req.params.id,
      req.user.person_id,
      req.user.roles || []
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/payroll/payslips/:id/pdf — View/Download payslip PDF */
export const downloadPayslipPdf = async (req, res, next) => {
  try {
    const { pdfBuffer, fileName } = await service.generatePayslipPdfBuffer(
      req.currentTenantId,
      req.params.id,
      req.user.person_id,
      req.user.roles || []
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.status(200).send(pdfBuffer);
  } catch (err) { next(err); }
};

/** POST /api/payroll/payslips — Create/upload payslip PDF metadata */
export const uploadPayslip = async (req, res, next) => {
  try {
    const result = await service.createPayslip(
      req.currentTenantId,
      req.user.person_id,
      req.body
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};
