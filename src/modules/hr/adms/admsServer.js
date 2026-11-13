/**
 * Extra ADMS listeners on common ZK ports (default 8088 / 86).
 * Main app already serves /iclock on PORT (5000).
 * Configure via ADMS_EXTRA_PORTS=8088,86
 */
const express = require('express');
const config = require('../../../config');
const admsRoutes = require('./adms.routes');

let servers = [];

const startAdmsExtraServers = () => {
  const ports = config.admsExtraPorts || [];
  for (const port of ports) {
    if (port === config.port) continue;
    try {
      const app = express();
      app.set('trust proxy', true);
      app.use((req, _res, next) => {
        console.log(`[adms:${port}] ${req.method} ${req.url} from ${req.ip}`);
        next();
      });
      app.use('/iclock', express.text({ type: '*/*', limit: '5mb' }), admsRoutes);
      // Some firmwares hit root paths
      app.use('/', express.text({ type: '*/*', limit: '5mb' }), admsRoutes);
      const server = app.listen(port, '0.0.0.0', () => {
        console.log(`[adms] extra listener on 0.0.0.0:${port}`);
      });
      server.on('error', (err) => {
        console.warn(`[adms] port ${port} not available: ${err.message}`);
      });
      servers.push(server);
    } catch (err) {
      console.warn(`[adms] failed to bind ${port}:`, err.message);
    }
  }
};

const stopAdmsExtraServers = () => {
  for (const s of servers) {
    try {
      s.close();
    } catch {
      /* ignore */
    }
  }
  servers = [];
};

module.exports = { startAdmsExtraServers, stopAdmsExtraServers };
