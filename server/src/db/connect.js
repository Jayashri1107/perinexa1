import mongoose from './mongoose.js';
import { config } from '../config/index.js';

export async function connectDatabase() {
  await mongoose.connect(config.database.uri);
  console.log(`Database connected: ${mongoose.connection.name}`);
}

export const disconnectDatabase = () => mongoose.disconnect();
