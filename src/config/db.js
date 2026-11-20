import mongoose from 'mongoose';

export async function connectDatabase() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required. Add it to backend/.env before starting the API.');
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 12000,
        connectTimeoutMS: 10000,
      });
      console.log('Connected to MongoDB');
      return;
    } catch (error) {
      const isNetworkError = /ETIMEDOUT|ECONNRESET|ENETUNREACH|EHOSTUNREACH/i.test(error.message);
      if (!isNetworkError || attempt === maxAttempts) {
        if (isNetworkError) {
          throw new Error(
            'MongoDB Atlas is not reachable after three attempts. Confirm the cluster is active, your current public IP is on Atlas Network Access, and outbound TCP 27017 is allowed.'
          );
        }
        throw error;
      }

      console.error(`MongoDB connection attempt ${attempt}/${maxAttempts} failed due to a network error; retrying.`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
