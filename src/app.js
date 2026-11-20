import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import itemRoutes from './routes/itemRoutes.js';
import purchaseRequestRoutes from './routes/purchaseRequestRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import auditLogRoutes from './routes/auditLogRoutes.js';
import { authorize, protect } from './middleware/auth.js';

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  const changesState = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const expectedOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
  if (changesState && req.cookies?.rpms_session && req.get('origin') !== expectedOrigin) {
    return res.status(403).json({ message: 'Request origin is not allowed.' });
  }
  return next();
});
app.use(morgan('dev'));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Please try again later.' },
});

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', service: 'restaurant-rpms-api' });
});

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', protect, authorize('admin'), userRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/items', itemRoutes);
app.use('/api/v1/purchase-requests', purchaseRequestRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/audit-logs', auditLogRoutes);
app.use((req, res) => {
  res.status(404).json({ message: 'API route not found.' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong on the server.' });
});

export default app;
