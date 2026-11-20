import mongoose from 'mongoose';

const itemLineSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    itemNameSnapshot: { type: String, required: true },
    quantityRequested: { type: Number, required: true, min: 1 },
    quantityPurchased: { type: Number, default: 0, min: 0 },
    unitSnapshot: { type: String, required: true },
    itemNotes: { type: String, default: '' },
  },
  { _id: false }
);

const commentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 2000 },
  createdAt: { type: Date, default: Date.now },
});

const purchaseRequestSchema = new mongoose.Schema(
  {
    requestNumber: { type: String, required: true, unique: true },
    idempotencyKey: { type: String, default: undefined, unique: true, sparse: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    department: {
      type: String,
      enum: ['Kitchen', 'Stock'],
      required: true,
    },
    items: [itemLineSchema],
    notes: { type: String, default: '' },
    comments: [commentSchema],
    status: {
      type: String,
      enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PARTIALLY_PURCHASED', 'PURCHASED'],
      default: 'PENDING_APPROVAL',
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    rejectionReason: { type: String, default: '' },
    purchasedAt: { type: Date },
  },
  { timestamps: true }
);

purchaseRequestSchema.index({ requestedBy: 1, createdAt: -1 });
purchaseRequestSchema.index({ status: 1, createdAt: -1 });
purchaseRequestSchema.index({ department: 1, createdAt: -1 });

export default mongoose.model('PurchaseRequest', purchaseRequestSchema);
