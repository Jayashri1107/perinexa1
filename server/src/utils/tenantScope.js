import mongoose from 'mongoose';

const GUARDED_QUERIES = [
  'find',
  'findOne',
  'countDocuments',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];

// One hospital, named plainly (health check L6, 16 Nov 2026): an ObjectId, its text, or { $eq: one } – never an
// operator that could match several hospitals ({ $in }, { $ne }, { $exists } …), which used to pass because only the
// presence of tenantId was checked.
const oneHospital = (v) =>
  typeof v === 'string' ||
  v instanceof mongoose.Types.ObjectId ||
  v?._bsontype === 'ObjectId' ||
  (v != null && typeof v === 'object' && Object.keys(v).length === 1 && '$eq' in v && oneHospital(v.$eq));

// Safety net for hospital data: adds a required tenantId to the model and refuses any
// query that does not say which hospital (tenant) it is for. This makes it very hard to
// accidentally read or change another hospital's records.
export function tenantScoped(schema) {
  schema.add({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true, immutable: true },
  });

  for (const op of GUARDED_QUERIES) {
    schema.pre(op, function () {
      const filter = this.getFilter();
      if (!filter || filter.tenantId == null) {
        throw new Error(`Refusing ${op} on ${this.model.modelName} without a tenantId filter`);
      }
      if (!oneHospital(filter.tenantId)) throw new Error(`Refusing ${op} on ${this.model.modelName}: tenantId must name one hospital`);
    });
  }

  schema.pre('aggregate', function () {
    const first = this.pipeline()[0];
    if (!first?.$match || first.$match.tenantId == null) {
      throw new Error(`Refusing aggregate on ${this._model?.modelName ?? 'model'} without a leading tenantId $match`);
    }
    if (!oneHospital(first.$match.tenantId)) throw new Error(`Refusing aggregate on ${this._model?.modelName ?? 'model'}: tenantId must name one hospital`);
  });
}
