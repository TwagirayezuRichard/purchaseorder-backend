import dotenv from 'dotenv';

dotenv.config();

export default {
  PORT: Number(process.env.PORT) || 5000,
  JWT_SECRET: process.env.JWT_SECRET || '',
  MONGO_URI: process.env.MONGO_URI || '',
  NODE_ENV: process.env.NODE_ENV || 'development',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
};
