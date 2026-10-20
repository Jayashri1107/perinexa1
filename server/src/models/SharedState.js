import mongoose from 'mongoose';

// Short-lived working state that every copy of the server must see (scaling out, 20 Oct 2026): an ABDM step started
// on one copy and finished on another, the one-time keys for records another hospital sends, the request limits, the
// background-job turns. Kept in the database instead of one server's memory; MongoDB removes each entry when its
// `until` has passed. Values that hold personal or secret data are stored encrypted (utils/sharedState.js).
//
// NOT tenant-scoped: entries are found by their own id; the hospital, when there is one, is inside the value and
// checked by the code that reads it.

const sharedStateSchema = new mongoose.Schema(
  {
    _id: { type: String }, // "<namespace>:<key>"
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    secret: { type: String, default: null }, // encrypted JSON, instead of `value`
    count: { type: Number, default: 0 }, // request limits
    until: { type: Date, required: true }, // by the app's clock: the entry counts until then
    // When MongoDB removes it, by the computer's real clock (a frozen test clock never makes it vanish mid-test)
    purgeAt: { type: Date, required: true },
  },
  { versionKey: false },
);
sharedStateSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const SharedState = mongoose.model('SharedState', sharedStateSchema);
