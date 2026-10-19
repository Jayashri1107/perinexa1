import mongoose from 'mongoose';

// Wrong passwords in a row for one staff sign-in email (owner, 19 Oct 2026 – auth/loginLock.js): after 3, the email is
// locked for 2 minutes. Kept for any email typed, known or not, so the answer never shows whether an account exists.
// Not hospital data (sign-in comes before choosing a hospital). Removed a day after the last change.
const loginLockSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, maxlength: 300 }, // 'staff:<email>'
    failures: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
loginLockSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 3600 });

export const LoginLock = mongoose.model('LoginLock', loginLockSchema);
