import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null)
    || req.cookies?.rpms_session;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('_id role isActive fullName email department');
    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'This account is inactive or no longer available.' });
    }
    req.user = {
      ...decoded,
      role: user.role,
      fullName: user.fullName,
      email: user.email,
      department: user.department,
    };
    next();
  } catch (error) {
    if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError') {
      console.error('Authentication check failed:', error.message);
      return res.status(500).json({ message: 'Unable to verify your session.' });
    }
    return res.status(401).json({ message: 'Token expired or invalid.' });
  }
};

export const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'You do not have permission to perform this action.' });
  }

  next();
};
