import { RoleService } from '../../services/admin/RoleService.js';

export const getRoles = async (req, res, next) => {
  try {
    const roles = await RoleService.getRoles(req.user.organization_id);
    res.json({ status: 'success', data: roles });
  } catch (error) {
    next(error);
  }
};

export const getPermissions = async (req, res, next) => {
  try {
    const permissions = await RoleService.getPermissions();
    res.json({ status: 'success', data: permissions });
  } catch (error) {
    next(error);
  }
};

export const createRole = async (req, res, next) => {
  try {
    const role = await RoleService.createRole(req.user.organization_id, req.body);
    res.status(201).json({ status: 'success', data: role });
  } catch (error) {
    next(error);
  }
};

export const updateRole = async (req, res, next) => {
  try {
    const role = await RoleService.updateRole(req.user.organization_id, req.params.roleId, req.body);
    res.json({ status: 'success', data: role });
  } catch (error) {
    next(error);
  }
};

export const deleteRole = async (req, res, next) => {
  try {
    const result = await RoleService.deleteRole(req.user.organization_id, req.params.roleId);
    res.json({ status: 'success', data: result });
  } catch (error) {
    next(error);
  }
};

export const assignPermissions = async (req, res, next) => {
  try {
    const { roleId } = req.params;
    const { permissionIds } = req.body;
    const result = await RoleService.assignPermissions(req.user.organization_id, roleId, permissionIds);
    res.json({ status: 'success', data: result, message: 'Permissions updated successfully' });
  } catch (error) {
    next(error);
  }
};
