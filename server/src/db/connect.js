import mongoose from './mongoose.js';
import { config } from '../config/index.js';

export async function connectDatabase() {
  // a pool of connections, so many people's requests are served side by side; a database that does not answer within
  // 10 seconds gives a clear error instead of a hanging page
  await mongoose.connect(config.database.uri, { maxPoolSize: config.database.maxPoolSize, serverSelectionTimeoutMS: 10_000 });
  console.log(`Database connected: ${mongoose.connection.name}`);
}

export const disconnectDatabase = () => mongoose.disconnect();
