import mongoose from 'mongoose';

// Voice entry: a person's own words – a short phrase they use (e.g. "asma", "hypo", "PCOD") and what it means
// in the patient form (e.g. "condition:asthma"). Saved only when the person confirms "remember", personal to
// their account (not to a hospital), and never patient information: no transcripts, no values.
const dictationWordSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    phrase: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
    meaning: { type: String, required: true, trim: true, maxlength: 80 },
  },
  { timestamps: true },
);
dictationWordSchema.index({ userId: 1, phrase: 1 }, { unique: true });

dictationWordSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.userId;
    return ret;
  },
});

export const DictationWord = mongoose.model('DictationWord', dictationWordSchema);
