import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    purchaseRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequest', required: true },
    recipient: { type: String, required: true },
    channel: { type: String, enum: ['email'], required: true },
    notificationType: { type: String, default: 'request_submitted' },
    status: {
      type: String,
      enum: ['pending', 'processing', 'sent', 'failed', 'retry_scheduled'],
      default: 'pending',
    },
    providerMessageId: { type: String, default: '' },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    errorMessage: { type: String, default: '' },
    nextRetryAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ status: 1, nextRetryAt: 1 });
notificationSchema.index({ channel: 1, providerMessageId: 1 }, { sparse: true });

export default mongoose.model('Notification', notificationSchema);
