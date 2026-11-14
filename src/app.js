require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config');
const { registerModules } = require('./modules');
const { notFound, errorHandler } = require('./shared/middleware/errorHandler');
const admsRoutes = require('./modules/hr/adms/adms.routes');

const createApp = () => {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
    })
  );

  // Trust proxy / device IPs
  app.set('trust proxy', true);

  // ZKTeco ADMS push (plain text bodies) — must be before JSON parser
  app.use((req, res, next) => {
    if (req.path.startsWith('/iclock') || req.path.includes('cdata') || req.path.includes('getrequest')) {
      console.log(`[adms:5000] ${req.method} ${req.url} from ${req.ip}`);
    }
    next();
  });
  app.use(
    '/iclock',
    express.text({ type: '*/*', limit: '5mb' }),
    admsRoutes
  );

  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: true, limit: '8mb' }));
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

  app.get('/', (req, res) => {
    res.json({
      success: true,
      message: 'Fatman Burgers POS API',
      version: 'v1',
      architecture: 'express-business-logic + mongodb-data',
      offline: 'client outbox -> /api/v1/rpc/pos_sync',
      adms: '/iclock/cdata',
      docs: {
        health: '/api/v1/health',
        ping: '/api/v1/ping',
        rpc: '/api/v1/rpc/:fn',
      },
    });
  });

  registerModules(app, { apiPrefix: '/api/v1' });

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = createApp;
