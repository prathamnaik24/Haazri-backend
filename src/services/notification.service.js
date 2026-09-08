import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';

export class NotificationService {
  /**
   * Create a durable in-app notification record.
   * Safe to call inside an existing database transaction client or standalone.
   * Includes deduplication check against API retry storms.
   */
  static async createNotification(
    dbOrClient,
    { tenantId, personId, type, title, message, entityType = null, entityId = null, metadata = {} }
  ) {
    if (!tenantId || !personId || !type || !title || !message) {
      console.warn('[NotificationService] Missing required parameters for notification creation');
      return null;
    }

    const runner = dbOrClient || db;

    try {
      // 1. Deduplication guard: Check if an identical notification was logged very recently (within 5 minutes)
      if (entityId && entityType) {
        const dupCheck = await runner.query(
          `SELECT id FROM notifications
           WHERE person_id = $1 AND organization_id = $2 AND type = $3
             AND entity_type = $4 AND entity_id = $5
             AND created_at >= NOW() - INTERVAL '5 minutes'
           LIMIT 1`,
          [personId, tenantId, type, entityType, entityId]
        );

        if (dupCheck.rows.length > 0) {
          // Already recorded
          return dupCheck.rows[0];
        }
      }

      // 2. Insert notification record
      const result = await runner.query(
        `INSERT INTO notifications (
           organization_id, person_id, type, title, message, entity_type, entity_id, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id, organization_id, person_id, type, title, message, entity_type, entity_id, metadata, is_read, created_at`,
        [
          tenantId,
          personId,
          type,
          title,
          message,
          entityType,
          entityId || null,
          JSON.stringify(metadata || {}),
        ]
      );

      return result.rows[0];
    } catch (err) {
      console.error('[NotificationService] Failed to create notification:', err);
      // Non-blocking: Do not fail the parent transaction if notification insert fails
      return null;
    }
  }

  /**
   * Fetch paginated notification feed for the authenticated user.
   */
  static async getMyNotifications(personId, tenantId, options = {}) {
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(options.offset, 10) || 0, 0);
    const unreadOnly = options.unreadOnly === true || options.unreadOnly === 'true';

    const conditions = ['person_id = $1', 'organization_id = $2'];
    const params = [personId, tenantId];

    if (unreadOnly) {
      conditions.push('is_read = false');
    }

    const whereClause = conditions.join(' AND ');

    // Query notifications
    const listQuery = `
      SELECT id, type, title, message, entity_type, entity_id, metadata, is_read, read_at, created_at
      FROM notifications
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const countQuery = `
      SELECT COUNT(id)::int as total
      FROM notifications
      WHERE ${whereClause}
    `;

    const unreadCountQuery = `
      SELECT COUNT(id)::int as unread_count
      FROM notifications
      WHERE person_id = $1 AND organization_id = $2 AND is_read = false
    `;

    const [listRes, countRes, unreadRes] = await Promise.all([
      db.query(listQuery, [...params, limit, offset]),
      db.query(countQuery, params),
      db.query(unreadCountQuery, [personId, tenantId]),
    ]);

    return {
      notifications: listRes.rows,
      total: countRes.rows[0]?.total || 0,
      unread_count: unreadRes.rows[0]?.unread_count || 0,
      limit,
      offset,
    };
  }

  /**
   * Quick count of unread notifications for badge rendering.
   */
  static async getUnreadCount(personId, tenantId) {
    const res = await db.query(
      `SELECT COUNT(id)::int as unread_count
       FROM notifications
       WHERE person_id = $1 AND organization_id = $2 AND is_read = false`,
      [personId, tenantId]
    );

    return { unread_count: res.rows[0]?.unread_count || 0 };
  }

  /**
   * Mark a single notification as read.
   */
  static async markAsRead(personId, tenantId, notificationId) {
    if (!notificationId) {
      throw new AppError('Notification ID is required', 400);
    }

    const res = await db.query(
      `UPDATE notifications
       SET is_read = true,
           read_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND person_id = $2 AND organization_id = $3
       RETURNING id, is_read, read_at`,
      [notificationId, personId, tenantId]
    );

    if (res.rows.length === 0) {
      throw new AppError('Notification not found or access denied', 404);
    }

    return res.rows[0];
  }

  /**
   * Mark all unread notifications as read for this user.
   */
  static async markAllAsRead(personId, tenantId) {
    const res = await db.query(
      `UPDATE notifications
       SET is_read = true,
           read_at = CURRENT_TIMESTAMP
       WHERE person_id = $1 AND organization_id = $2 AND is_read = false
       RETURNING id`,
      [personId, tenantId]
    );

    return {
      success: true,
      marked_count: res.rows.length,
    };
  }
}
