import { NotificationService } from '../services/notification.service.js';

/**
 * GET /api/notifications
 * Query options: limit, offset, unreadOnly
 */
export const getMyNotifications = async (req, res, next) => {
  try {
    const result = await NotificationService.getMyNotifications(
      req.user.person_id,
      req.currentTenantId,
      {
        limit: req.query.limit,
        offset: req.query.offset,
        unreadOnly: req.query.unreadOnly,
      }
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/notifications/unread-count
 */
export const getUnreadCount = async (req, res, next) => {
  try {
    const result = await NotificationService.getUnreadCount(
      req.user.person_id,
      req.currentTenantId
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/notifications/:id/read
 */
export const markAsRead = async (req, res, next) => {
  try {
    const result = await NotificationService.markAsRead(
      req.user.person_id,
      req.currentTenantId,
      req.params.id
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/notifications/read-all
 */
export const markAllAsRead = async (req, res, next) => {
  try {
    const result = await NotificationService.markAllAsRead(
      req.user.person_id,
      req.currentTenantId
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
};
