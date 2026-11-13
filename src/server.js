const createApp = require('./app');
const config = require('./config');
const connectDB = require('./config/db');

const startServer = async () => {
  try {
    await connectDB();

    const app = createApp();

    const { startAttendanceWorker, stopAttendanceWorker } = require('./modules/hr/workers/attendanceWorker');
    const { startZkPullWorker, stopZkPullWorker } = require('./modules/hr/workers/zkPullWorker');
    const { startAdmsExtraServers, stopAdmsExtraServers } = require('./modules/hr/adms/admsServer');
    startAttendanceWorker({ intervalMs: 120000 });
    if (config.zkPullEnabled) {
      startZkPullWorker({ intervalMs: 60000 });
    } else {
      console.log('[zk-pull-worker] disabled (ZK_PULL_ENABLED=false) — ADMS-only mode');
    }
    startAdmsExtraServers();

    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log(`Server running in ${config.env} mode on port ${config.port}`);
      const extra = (config.admsExtraPorts || []).join(', ');
      console.log(
        `ADMS: http://0.0.0.0:${config.port}/iclock/cdata` +
          (extra ? ` (+ ports ${extra})` : '')
      );
      if (config.admsPublicUrl) {
        console.log(`ADMS public URL (set on device): ${config.admsPublicUrl}`);
      }
    });

    const shutdown = async (signal) => {
      console.log(`${signal} received. Shutting down...`);
      stopAttendanceWorker();
      stopZkPullWorker();
      stopAdmsExtraServers();
      server.close(async () => {
        const mongoose = require('mongoose');
        await mongoose.connection.close();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
};

startServer();
