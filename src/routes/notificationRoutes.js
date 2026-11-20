import express from 'express';
import { getNotifications, getRequestNotifications, retryNotification } from '../controllers/notificationController.js';
import { authorize, protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, authorize('admin'), getNotifications);
router.get('/request/:requestId', protect, getRequestNotifications);
router.post('/:id/retry', protect, authorize('admin'), retryNotification);

export default router;
