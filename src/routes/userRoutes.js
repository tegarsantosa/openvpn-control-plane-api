const express = require('express');
const userController = require('../controllers/userController');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

router.get(
  '/vpns',
  authenticateUser,
  userController.listVpns
);

router.get(
  '/vpns/:vpn_id',
  authenticateUser,
  userController.getVpnDetails
);

module.exports = router;
