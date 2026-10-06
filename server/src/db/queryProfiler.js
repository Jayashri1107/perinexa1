// Query evaluation: times every query and aggregate and warns about slow ones (config.database.slowQueryMs),
// or logs all of them when config.database.logAllQueries is on. Only field names are logged, never values,
// so no personal data ends up in the log. `npm run db:evaluate` checks which index each main list uses.
import { performance } from 'node:perf_hooks';
import { config } from '../config/index.js';

const QUERY_OPS = ['find', 'findOne', 'countDocuments', 'findOneAndUpdate', 'updateOne', 'updateMany', 'deleteOne'];
const { slowQueryMs, logAllQueries } = config.database;

function report(model, op, shape, ms) {
  if (!logAllQueries && ms < slowQueryMs) return;
  const label = ms >= slowQueryMs ? 'SLOW query' : 'query';
  console.warn(`[${label}] ${model}.${op} ${ms.toFixed(1)} ms – fields: ${shape.join(', ') || '(none)'}`);
}

export function queryProfiler(schema) {
  for (const op of QUERY_OPS) {
    schema.pre(op, function () {
      this._startedAt = performance.now();
    });
    schema.post(op, function () {
      report(this.model.modelName, op, Object.keys(this.getFilter() ?? {}), performance.now() - this._startedAt);
    });
  }
  schema.pre('aggregate', function () {
    this._startedAt = performance.now();
  });
  schema.post('aggregate', function () {
    const stages = this.pipeline().map((s) => Object.keys(s)[0]);
    report(this._model?.modelName ?? 'model', 'aggregate', stages, performance.now() - this._startedAt);
  });
}
