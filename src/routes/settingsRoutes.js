import express from 'express';
import { getNotificationSettings } from '../controllers/settingsController.js';
import { authorize, protect } from '../middleware/auth.js';

const router = express.Router();
router.get('/notifications', protect, authorize('admin'), getNotificationSettings);

export default router;
