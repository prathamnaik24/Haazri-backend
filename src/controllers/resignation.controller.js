import { ResignationService } from '../services/resignation.service.js';

export const submitResignation = async (req, res, next) => {
  try {
    const personId = req.user.person_id;
    const tenantId = req.user.organization_id;
    const resignation = await ResignationService.submitResignation(personId, tenantId, req.body);
    res.status(201).json({
      status: 'success',
      data: { resignation },
    });
  } catch (err) {
    next(err);
  }
};

export const getOwnResignations = async (req, res, next) => {
  try {
    const personId = req.user.person_id;
    const tenantId = req.user.organization_id;
    const resignations = await ResignationService.getOwnResignations(personId, tenantId);
    res.status(200).json({
      status: 'success',
      data: { resignations },
    });
  } catch (err) {
    next(err);
  }
};

export const getManagerResignations = async (req, res, next) => {
  try {
    const managerPersonId = req.user.person_id;
    const tenantId = req.user.organization_id;
    const userRoles = req.user.roles || [];
    const resignations = await ResignationService.getManagerResignations(managerPersonId, tenantId, userRoles);
    res.status(200).json({
      status: 'success',
      data: { resignations },
    });
  } catch (err) {
    next(err);
  }
};

export const managerAction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const managerPersonId = req.user.person_id;
    const tenantId = req.user.organization_id;
    const userRoles = req.user.roles || [];
    const resignation = await ResignationService.actionManagerReview(id, managerPersonId, tenantId, req.body, userRoles);
    res.status(200).json({
      status: 'success',
      data: { resignation },
    });
  } catch (err) {
    next(err);
  }
};

export const getHRResignations = async (req, res, next) => {
  try {
    const tenantId = req.user.organization_id;
    const resignations = await ResignationService.getHRResignations(tenantId, req.query);
    res.status(200).json({
      status: 'success',
      data: { resignations },
    });
  } catch (err) {
    next(err);
  }
};

export const hrAction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const hrPersonId = req.user.person_id;
    const tenantId = req.user.organization_id;
    const resignation = await ResignationService.actionHRReview(id, hrPersonId, tenantId, req.body);
    res.status(200).json({
      status: 'success',
      data: { resignation },
    });
  } catch (err) {
    next(err);
  }
};

export const completeResignation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const hrPersonId = req.user.person_id;
    const tenantId = req.user.organization_id;
    const resignation = await ResignationService.completeResignation(id, hrPersonId, tenantId, req.body);
    res.status(200).json({
      status: 'success',
      data: { resignation },
    });
  } catch (err) {
    next(err);
  }
};

export const getResignationById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const requestingPersonId = req.user.person_id;
    const tenantId = req.user.organization_id;
    const userRoles = req.user.roles || [];
    const resignation = await ResignationService.getResignationById(id, tenantId, requestingPersonId, userRoles);
    res.status(200).json({
      status: 'success',
      data: { resignation },
    });
  } catch (err) {
    next(err);
  }
};
