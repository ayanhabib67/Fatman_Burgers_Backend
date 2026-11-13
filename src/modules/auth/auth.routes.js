const express = require('express');
const { register, listUsers } = require('./auth.controller');

const router = express.Router();

router.post('/register', register);
router.get('/users', listUsers);

module.exports = router;
