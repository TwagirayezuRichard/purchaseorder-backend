import AuditLog from '../models/AuditLog.js';

export const getAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find()
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(200);
    return res.json(logs);
  } catch (error) {
    console.error('Get audit logs failed:', error.message);
    return res.status(500).json({ message: 'Unable to load activity logs.' });
  }
};
