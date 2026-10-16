import mongoose from 'mongoose';

// A person's own typing shortcut (doctor ideas #3, 16 Oct 2026): typing ".fu2" and a space in a text box becomes
// "Follow up after 2 weeks with CBC report". Personal to their account (not to a hospital), like their voice words;
// the text is a sentence they often write – never patient information (the page says so).
const shortcutSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true, trim: true, lowercase: true, maxlength: 20 }, // without the dot
    text: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);
shortcutSchema.index({ userId: 1, key: 1 }, { unique: true });

shortcutSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.userId;
    return ret;
  },
});

export const TextShortcut = mongoose.model('TextShortcut', shortcutSchema);
