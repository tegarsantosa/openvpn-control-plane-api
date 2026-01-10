const express = require('express');
const taskController = require('../controllers/taskController');
const { authenticateUser, authenticateAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/:task_id', authenticateUser, taskController.getTask);

router.get('/', authenticateAdmin, taskController.listTasks);

module.exports = router;