import mongoose from 'mongoose';
import { env } from './config/env.js';

let connected = false;

export async function connectDb() {
  if (!env.mongoUri) {
    console.warn('[db] no MONGODB_URI — running without persistence');
    return false;
  }
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 });
    connected = true;
    console.log('[db] connected');
  } catch (err) {
    console.error('[db] connection failed:', err.message);
    connected = false;
  }
  return connected;
}

export const dbReady = () => mongoose.connection.readyState === 1;
