// Safety net for hospital-owned data (the same idea as Perinexa's tenantScoped): adds a required hospitalId and refuses
// every query or aggregate that does not say which hospital it is for, so one hospital can never read or change
// another hospital's records by mistake.
import mongoose from './mongoose.js';

const GUARDED_QUERIES = [
  'find', 'findOne', 'countDocuments', 'updateOne', 'updateMany', 'replaceOne',
  'findOneAndUpdate', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete',
];

export function hospitalScoped(schema) {
  schema.add({ hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true, immutable: true } });

  for (const op of GUARDED_QUERIES) {
    schema.pre(op, function () {
      if (this.getFilter()?.hospitalId == null) {
        throw new Error(`Refusing ${op} on ${this.model.modelName} without a hospitalId filter`);
      }
    });
  }

  schema.pre('aggregate', function () {
    const first = this.pipeline()[0];
    if (first?.$match?.hospitalId == null) {
      throw new Error(`Refusing aggregate on ${this._model?.modelName ?? 'model'} without a leading hospitalId $match`);
    }
  });
}
