import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';

const signToken = (user) =>
  jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      department: user.department,
    },
    env.JWT_SECRET,
    { expiresIn: '8h' }
  );

const isDatabaseUnavailable = (error) =>
  ['MongooseServerSelectionError', 'MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoTimeoutError']
    .includes(error.name);

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() })
      .select('_id email fullName role department isActive passwordHash')
      .maxTimeMS(5000)
      .lean();

    if (!user || !user.isActive || !(await bcrypt.compare(String(password), user.passwordHash))) {
      return res.status(401).json({ message: 'Invalid login credentials.' });
    }

    const token = signToken(user);
    res.cookie('rpms_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });

    return res.json({
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        department: user.department,
      },
    });
  } catch (error) {
    console.error('Login failed:', error.message);
    if (isDatabaseUnavailable(error) || error.code === 50) {
      return res.status(503).json({ message: 'Sign-in is temporarily unavailable while the database reconnects. Please try again shortly.' });
    }
    return res.status(500).json({ message: 'Unable to log in right now.' });
  }
};

export const logout = (req, res) => {
  res.clearCookie('rpms_session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
  });
  return res.json({ message: 'Logged out successfully.' });
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || String(newPassword).length < 12) {
      return res.status(400).json({ message: 'Current password and a new password of at least 12 characters are required.' });
    }

    const user = await User.findById(req.user.id);
    if (!user || !(await bcrypt.compare(String(currentPassword), user.passwordHash))) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ message: 'New password must be different from the current password.' });
    }

    user.passwordHash = await bcrypt.hash(String(newPassword), 12);
    await user.save();
    return logout(req, res);
  } catch (error) {
    console.error('Change password failed:', error.message);
    return res.status(500).json({ message: 'Unable to change password.' });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.json(user);
  } catch (error) {
    console.error('Load current user failed:', error.message);
    return res.status(500).json({ message: 'Unable to load user profile.' });
  }
};
