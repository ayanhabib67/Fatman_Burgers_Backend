/**
 * Per-outlet serialized writer (replaces Postgres advisory locks for single-node).
 * Multi-instance deploys will need Redis / Mongo distributed locks later.
 */
const queues = new Map();

const withOutletLock = async (outlet, fn) => {
  const key = String(outlet || 'default');
  const prev = queues.get(key) || Promise.resolve();

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const next = prev.then(() => gate);
  queues.set(key, next);

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (queues.get(key) === next) {
      queues.delete(key);
    }
  }
};

module.exports = { withOutletLock };
