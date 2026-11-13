const Device = require('../models/Device');
const { pullDevice } = require('../services/zkAgent.service');

let timer = null;
let running = false;

const tick = async () => {
  if (running) return;
  running = true;
  try {
    // Only try TCP pull for devices that are not ADMS-primary failures every minute.
    // ADMS devices push to /iclock — skip noisy TCP errors for them.
    const devices = await Device.find({
      active: true,
      ipAddress: { $nin: ['', '127.0.0.1'] },
      location: { $ne: 'ADMS push' },
    }).lean();
    const results = [];
    for (const d of devices) {
      try {
        results.push({ ok: true, ...(await pullDevice(d._id)) });
      } catch (err) {
        results.push({ ok: false, code: d.code, error: err.message });
      }
    }
    const ok = results.filter((r) => r.ok);
    const created = ok.reduce((n, r) => n + (r.created || 0), 0);
    if (created > 0 || results.some((r) => !r.ok)) {
      console.log(
        `[zk-pull-worker] devices=${results.length} created=${created} errors=${
          results.filter((r) => !r.ok).length
        }`
      );
    }
  } catch (err) {
    console.error('[zk-pull-worker]', err.message || err);
  } finally {
    running = false;
  }
};

const startZkPullWorker = ({ intervalMs = 60000 } = {}) => {
  if (timer) return;
  console.log(`[zk-pull-worker] started (every ${intervalMs / 1000}s)`);
  setTimeout(tick, 8000);
  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
};

const stopZkPullWorker = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = {
  startZkPullWorker,
  stopZkPullWorker,
  tick,
};
