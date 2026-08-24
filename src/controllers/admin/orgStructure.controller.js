import { OrgStructureService } from '../../services/admin/OrgStructureService.js';

export const getTemplates = (req, res) => {
  const templates = OrgStructureService.getTemplatesList();
  res.json({ status: 'success', data: templates });
};

export const applyTemplate = async (req, res, next) => {
  try {
    const result = await OrgStructureService.applyTemplate(
      req.user.organization_id,
      req.body
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (error) {
    next(error);
  }
};

export const getDepartments = async (req, res, next) => {
  try {
    const departments = await OrgStructureService.getDepartments(req.user.organization_id);
    res.json(departments);
  } catch (error) {
    next(error);
  }
};

export const getPositionsTree = async (req, res, next) => {
  try {
    const tree = await OrgStructureService.getPositionsTree(req.user.organization_id);
    res.json(tree);
  } catch (error) {
    next(error);
  }
};

export const createPosition = async (req, res, next) => {
  try {
    const position = await OrgStructureService.createPosition(
      req.user.organization_id,
      req.body
    );
    res.status(201).json({ status: 'success', data: position });
  } catch (error) {
    next(error);
  }
};

export const updatePosition = async (req, res, next) => {
  try {
    const position = await OrgStructureService.updatePosition(
      req.user.organization_id,
      req.params.id,
      req.body
    );
    res.json({ status: 'success', data: position });
  } catch (error) {
    next(error);
  }
};

export const deletePosition = async (req, res, next) => {
  try {
    await OrgStructureService.deletePosition(
      req.user.organization_id,
      req.params.id
    );
    res.json({ status: 'success', message: 'Position deleted successfully' });
  } catch (error) {
    next(error);
  }
};
