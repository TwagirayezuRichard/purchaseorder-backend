import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    phoneNumber: { type: String, default: '' },
    role: {
      type: String,
      enum: ['admin', 'kitchen_manager', 'stock_manager'],
      required: true,
    },
    department: {
      type: String,
      enum: ['Kitchen', 'Stock', 'Administration'],
      default: 'Kitchen',
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
