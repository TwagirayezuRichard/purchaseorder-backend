import Notification from '../models/Notification.js';
import { processNotification } from '../services/notificationService.js';
import PurchaseRequest from '../models/PurchaseRequest.js';
import mongoose from 'mongoose';

export const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ channel: 'email' }).populate('purchaseRequestId').sort({ createdAt: -1 }).limit(200);
    return res.json(notifications);
  } catch (error) {
    console.error('Get notifications failed:', error.message);
    return res.status(500).json({ message: 'Unable to fetch notifications.' });
  }
};

export const retryNotification = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found.' });
    }
    if (notification.channel !== 'email') {
      return res.status(409).json({ message: 'Only email notifications can be retried.' });
    }

    if (notification.status === 'processing') {
      return res.status(409).json({ message: 'This notification is already being processed.' });
    }
    if (notification.status === 'sent') {
      return res.status(409).json({ message: 'This notification has already been accepted by its provider.' });
    }

    notification.status = 'pending';
    notification.attempts = 0;
    notification.nextRetryAt = null;
    notification.errorMessage = '';
    await notification.save();
    const retried = await processNotification(notification._id);
    return res.json({ message: 'Notification retry processed.', notification: retried });
  } catch (error) {
    console.error('Retry notification failed:', error.message);
    return res.status(500).json({ message: 'Unable to retry notification.' });
  }
};

export const getRequestNotifications = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.requestId)) {
      return res.status(400).json({ message: 'Invalid request ID.' });
    }
    const request = await PurchaseRequest.findById(req.params.requestId).select('requestedBy');
    if (!request) return res.status(404).json({ message: 'Request not found.' });
    if (req.user.role !== 'admin' && request.requestedBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You cannot access these notifications.' });
    }
    const notifications = await Notification.find({ purchaseRequestId: req.params.requestId, channel: 'email' }).sort({ createdAt: -1 });
    return res.json(notifications);
  } catch (error) {
    console.error('Get request notifications failed:', error.message);
    return res.status(500).json({ message: 'Unable to get request notifications.' });
  }
};
