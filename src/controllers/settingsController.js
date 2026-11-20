import { isEmailConfigured } from '../services/notificationService.js';

export const getNotificationSettings = (req, res) => {
  res.json({
    emailConfigured: isEmailConfigured(),
    adminEmailConfigured: Boolean(process.env.ADMIN_EMAIL),
  });
};
