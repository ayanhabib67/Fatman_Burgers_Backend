const express = require('express');
const {
  ping,
  login,
  sync,
  setPin,
  getMenu,
  seedMenu,
  upsertMenuItem,
  rpcDispatch,
} = require('./pos.controller');

const router = express.Router();

// Explicit POS endpoints
router.get('/ping', ping);
router.post('/ping', ping);
router.post('/login', login);
router.post('/sync', sync);
router.post('/set-pin', setPin);

// Menu (DB-oriented) — till loads this on boot
router.get('/menu', getMenu);
router.post('/menu/seed', seedMenu);
router.post('/menu/upsert', upsertMenuItem);

// Supabase-shaped compatibility surface used by the till client
router.post('/rpc/:fn', rpcDispatch);

module.exports = router;
