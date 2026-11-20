import nodemailer from 'nodemailer';
import Notification from '../models/Notification.js';
import PurchaseRequest from '../models/PurchaseRequest.js';

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);

const getRequest = async (requestId) =>
  PurchaseRequest.findById(requestId).populate('requestedBy');

export const isEmailConfigured = () => {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD &&
    process.env.EMAIL_FROM
  );
};

async function deliverEmail(notification, request) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM } = process.env;
  if (!isEmailConfigured() || !notification.recipient) {
    throw new Error('Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, ADMIN_EMAIL and EMAIL_FROM.');
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });

  const rows = request.items
    .map((item) => `<li>${escapeHtml(item.itemNameSnapshot)} — ${escapeHtml(item.quantityRequested)} ${escapeHtml(item.unitSnapshot)}</li>`)
    .join('');
  const dashboardUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/admin/request/${request._id}`;
  const isStatusUpdate = notification.notificationType !== 'request_submitted';
  const result = await transporter.sendMail({
    from: EMAIL_FROM,
    to: notification.recipient,
    subject: `${isStatusUpdate ? 'Purchase request update' : 'New purchase request'} ${request.requestNumber}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><h2>${isStatusUpdate ? 'Purchase request update' : 'New restaurant purchase request'}</h2><p><strong>${escapeHtml(request.requestNumber)}</strong></p><p>Requested by ${escapeHtml(request.requestedBy?.fullName || 'Employee')} (${escapeHtml(request.department)})</p><ul>${rows}</ul><p>${escapeHtml(request.notes || 'No additional notes.')}</p><p>Status: ${escapeHtml(request.status)}</p>${request.rejectionReason ? `<p>Reason: ${escapeHtml(request.rejectionReason)}</p>` : ''}<a href="${escapeHtml(dashboardUrl)}">Open request</a></div>`,
  });

  return result.messageId;
}

export async function processNotification(notificationId) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, channel: 'email', status: { $in: ['pending', 'failed', 'retry_scheduled'] } },
    {
      $set: { status: 'processing', lastAttemptAt: new Date(), errorMessage: '' },
      $inc: { attempts: 1 },
    },
    { returnDocument: 'after' }
  );
  if (!notification) return Notification.findById(notificationId);

  try {
    const request = await getRequest(notification.purchaseRequestId);
    if (!request) {
      throw new Error('The related purchase request no longer exists.');
    }

    notification.providerMessageId = await deliverEmail(notification, request);
    notification.status = 'sent';
    notification.deliveredAt = null;
    notification.nextRetryAt = null;
  } catch (error) {
    notification.status = notification.attempts < 5 ? 'retry_scheduled' : 'failed';
    notification.errorMessage = error.message;
    notification.nextRetryAt = notification.status === 'retry_scheduled'
      ? new Date(Date.now() + Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** (notification.attempts - 1))))
      : null;
    console.error(`Notification ${notification._id} failed:`, error.message);
  }

  await notification.save();
  return notification;
}

export async function queueNotifications(requestId, recipients) {
  if (recipients.some(({ channel }) => channel !== 'email')) {
    throw new Error('Only email notifications are supported.');
  }

  const jobs = await Notification.insertMany(
    recipients.map(({ channel, recipient, notificationType }) => ({
      purchaseRequestId: requestId,
      recipient,
      channel,
      notificationType: notificationType || 'request_submitted',
      status: 'pending',
    }))
  );

  setImmediate(() => {
    Promise.all(jobs.map((job) => processNotification(job._id))).catch((error) => {
      console.error('Notification delivery batch failed:', error.message);
    });
  });

  return jobs;
}

export function startNotificationWorker() {
  const run = async () => {
    const now = new Date();
    const pending = await Notification.find({
      channel: 'email',
      $or: [
        { status: 'pending' },
        { status: 'retry_scheduled', nextRetryAt: { $lte: now } },
      ],
    }).select('_id').limit(25);
    await Promise.all(pending.map(({ _id }) => processNotification(_id)));
  };

  const timer = setInterval(() => {
    run().catch((error) => console.error('Notification worker failed:', error.message));
  }, 30 * 1000);
  timer.unref();
  run().catch((error) => console.error('Initial notification worker run failed:', error.message));
  return timer;
}
