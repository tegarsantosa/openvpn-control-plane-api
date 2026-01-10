const express = require('express');
const { body } = require('express-validator');
const clientController = require('../controllers/clientController');
const { authenticateUser, validateRequest } = require('../middleware/auth');

const router = express.Router();

router.post(
  '/',
  authenticateUser,
  [
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }).withMessage('Name must be less than 100 characters'),
    body('server_id').trim().notEmpty().withMessage('Server ID is required'),
  ],
  validateRequest,
  clientController.createClient
);

router.delete('/:vpn_id', authenticateUser, clientController.deleteClient);

router.get('/', authenticateUser, clientController.listClients);

router.get('/:vpn_id/config', authenticateUser, clientController.getClientConfig);

module.exports = router;