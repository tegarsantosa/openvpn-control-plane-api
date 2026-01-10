const express = require('express');
const { body } = require('express-validator');
const serverController = require('../controllers/serverController');
const { authenticateAdmin, authenticateAgent, authenticateUser, validateRequest } = require('../middleware/auth');

const router = express.Router();

router.post(
  '/',
  authenticateAdmin,
  [
    body('server_id').trim().notEmpty().withMessage('Server ID is required'),
    body('location_id').isInt().withMessage('Valid location ID is required'),
  ],
  validateRequest,
  serverController.createServer
);

router.post('/register/:registration_token', serverController.registerServer);

router.get('/agent/install.sh', serverController.getInstallScript);

router.post('/agent/update-info', authenticateAgent, serverController.updateServerInfo);

router.get('/agent/script', authenticateAgent, serverController.getAgentScript);

router.get('/agent/service', authenticateAgent, serverController.getServiceFile);

router.get('/tasks', authenticateAgent, serverController.getTasks);

router.post('/tasks/:task_id/result', authenticateAgent, serverController.submitTaskResult);

router.get('/', authenticateAdmin, serverController.listServers);

router.get('/locations', authenticateUser, serverController.listLocations);

router.get('/:server_id', authenticateAdmin, serverController.getServerDetails);

router.post('/:server_id/regenerate-token', authenticateAdmin, serverController.regenerateToken);

module.exports = router;