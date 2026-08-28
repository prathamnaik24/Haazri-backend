import { HierarchyService } from '../services/HierarchyService.js';

/**
 * GET /api/org/hierarchy
 * Fetch complete organizational structure/chart.
 */
export const getHierarchy = async (req, res, next) => {
  try {
    const orgId = req.currentTenantId;
    const tree = await HierarchyService.getHierarchy(orgId);
    res.status(200).json({
      status: 'success',
      data: tree
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/org/hierarchy/move
 * Move a position or assign an employee to a new position.
 */
export const moveHierarchyNode = async (req, res, next) => {
  try {
    const orgId = req.currentTenantId;
    const operatorPersonId = req.user.person_id;
    const result = await HierarchyService.moveNode(orgId, operatorPersonId, req.body);
    res.status(200).json({
      status: 'success',
      data: result
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/org/hierarchy/mobility/:employeeId
 * Fetch full movement history for a given employee.
 */
export const getMobilityHistory = async (req, res, next) => {
  try {
    const orgId = req.currentTenantId;
    const { employeeId } = req.params;
    const history = await HierarchyService.getMobilityHistory(orgId, employeeId);
    res.status(200).json({
      status: 'success',
      data: history
    });
  } catch (err) {
    next(err);
  }
};
