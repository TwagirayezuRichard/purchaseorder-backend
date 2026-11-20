import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    unit: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    minimumStockLevel: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

itemSchema.index({ name: 1 });
itemSchema.index({ categoryId: 1, isActive: 1 });

export default mongoose.model('Item', itemSchema);
