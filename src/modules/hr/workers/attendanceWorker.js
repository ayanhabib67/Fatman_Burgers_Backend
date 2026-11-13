const { processPendingPunches } = require('../services/attendanceEngine');

let timer = null;
let running = false;

const tick = async () => {
  if (running) return;
  running = true;
  try {
    const result = await processPendingPunches({ limit: 300 });
    if (result.groups > 0) {
      console.log(`[hr-attendance-worker] rebuilt ${result.groups} employee-day group(s)`);
    }
  } catch (err) {
    console.error('[hr-attendance-worker]', err.message || err);
  } finally {
    running = false;
  }
};

const startAttendanceWorker = ({ intervalMs = 120000 } = {}) => {
  if (timer) return;
  console.log(`[hr-attendance-worker] started (every ${intervalMs / 1000}s)`);
  // first run shortly after boot
  setTimeout(tick, 5000);
  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
};

const stopAttendanceWorker = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = {
  startAttendanceWorker,
  stopAttendanceWorker,
  tick,
};
