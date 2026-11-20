import app from './app.js';
import mongoose from 'mongoose';
import env from './config/env.js';
import { connectDatabase } from './config/db.js';
import { seedDatabase } from './utils/seed.js';
import { startNotificationWorker } from './services/notificationService.js';

async function startServer() {
  try {
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must be set to a random value of at least 32 characters.');
    }

    await connectDatabase();
    await seedDatabase();
    startNotificationWorker();
    const server = app.listen(env.PORT, () => {
      console.log(`Restaurant RPMS API is running on http://localhost:${env.PORT}`);
    });

    const shutdown = async () => {
      server.close(async () => {
        await mongoose.disconnect();
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Server start failed:', error.message);
    process.exit(1);
  }
}

startServer();
