// A person's profile photo (My settings, owner 9 Oct 2026): one per person, kept apart from the account so the account
// (read on every request) stays small. The website shrinks it to 256 × 256 before sending; at most 200 KB is kept.
import mongoose from '../../db/mongoose.js';

const userPhotoSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    contentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true },
);

export const UserPhoto = mongoose.model('UserPhoto', userPhotoSchema, 'user_photos');
