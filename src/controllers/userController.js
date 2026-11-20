import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import AuditLog from '../models/AuditLog.js';

const publicUser = (user) => {
  const data = user.toObject();
  delete data.passwordHash;
  return data;
};

export const listUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).select('-passwordHash');
    return res.json(users);
  } catch (error) {
    console.error('List users failed:', error.message);
    return res.status(500).json({ message: 'Unable to fetch users.' });
  }
};

export const createUser = async (req, res) => {
  try {
    const { fullName, email, password, role, department, phoneNumber } = req.body;
    const allowedRoles = ['admin', 'kitchen_manager', 'stock_manager'];

    if (!fullName?.trim() || !email?.trim() || !password || !role || !allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Valid name, email, password and role are required.' });
    }
    if (String(password).length < 12) {
      return res.status(400).json({ message: 'Passwords must contain at least 12 characters.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const expectedDepartment = role === 'stock_manager' ? 'Stock' : role === 'kitchen_manager' ? 'Kitchen' : 'Administration';
    const user = await User.create({
      fullName: fullName.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(String(password), 12),
      phoneNumber: String(phoneNumber || '').trim(),
      role,
      department: role === 'admin' ? 'Administration' : expectedDepartment,
    });

    await AuditLog.create({
      userId: req.user.id,
      action: 'user_created',
      entityType: 'User',
      entityId: user._id.toString(),
      newValue: { email: user.email, role: user.role },
      ipAddress: req.ip,
    });

    return res.status(201).json({ message: 'Employee created successfully.', user: publicUser(user) });
  } catch (error) {
    console.error('Create user failed:', error.message);
    return res.status(500).json({ message: 'Unable to create employee.' });
  }
};

export const updateUser = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid user ID.' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Employee not found.' });

    const { fullName, email, phoneNumber, role } = req.body;
    if (fullName !== undefined) user.fullName = String(fullName).trim();
    if (email !== undefined) user.email = String(email).trim().toLowerCase();
    if (phoneNumber !== undefined) user.phoneNumber = String(phoneNumber).trim();
    if (role !== undefined) {
      if (!['admin', 'kitchen_manager', 'stock_manager'].includes(role)) {
        return res.status(400).json({ message: 'Invalid user role.' });
      }
      if (user.role === 'admin' && role !== 'admin') {
        const activeAdmins = await User.countDocuments({ role: 'admin', isActive: true });
        if (activeAdmins <= 1) return res.status(409).json({ message: 'The last active administrator cannot be demoted.' });
      }
      if (user._id.toString() === req.user.id && role !== 'admin') {
        return res.status(400).json({ message: 'You cannot change your own administrator role.' });
      }
      user.role = role;
      user.department = role === 'stock_manager' ? 'Stock' : role === 'kitchen_manager' ? 'Kitchen' : 'Administration';
    }
    await user.save();
    return res.json({ message: 'Employee updated.', user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A user with this email already exists.' });
    console.error('Update user failed:', error.message);
    return res.status(500).json({ message: 'Unable to update employee.' });
  }
};

export const updateUserStatus = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid user ID.' });
    if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ message: 'isActive must be a boolean.' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Employee not found.' });
    if (user._id.toString() === req.user.id && req.body.isActive === false) {
      return res.status(400).json({ message: 'You cannot deactivate your own account.' });
    }
    user.isActive = Boolean(req.body.isActive);
    if (!user.isActive && user.role === 'admin') {
      const activeAdmins = await User.countDocuments({ role: 'admin', isActive: true });
      if (activeAdmins <= 1) return res.status(409).json({ message: 'The last active administrator cannot be deactivated.' });
    }
    await user.save();
    return res.json({ message: 'Employee status updated.', user: publicUser(user) });
  } catch (error) {
    console.error('Update user status failed:', error.message);
    return res.status(500).json({ message: 'Unable to update employee status.' });
  }
};
