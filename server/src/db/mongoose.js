// Every model imports mongoose from here, so the shared plugins are registered before any model is built.
import mongoose from 'mongoose';
import { config } from '../config/index.js';
import { queryProfiler } from './queryProfiler.js';

mongoose.set('strictQuery', true);
mongoose.set('autoIndex', config.database.autoIndex);
mongoose.plugin(queryProfiler);

// API output: "id" instead of "_id", no "__v".
mongoose.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    delete ret._id;
    return ret;
  },
});

export default mongoose;
