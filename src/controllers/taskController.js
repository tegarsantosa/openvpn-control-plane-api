const TaskContext = require('../contexts/TaskContext');

const getTask = async (req, res) => {
  try {
    const { task_id } = req.params;

    const task = await TaskContext.findById(task_id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    if (!req.user.is_admin && task.user_id !== req.user.id) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    res.json({
      success: true,
      task,
    });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const listTasks = async (req, res) => {
  try {
    const { server_id, status, user_id } = req.query;

    const tasks = await TaskContext.list({
      serverId: server_id,
      status,
      userId: user_id,
    });

    res.json({
      success: true,
      tasks,
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

module.exports = {
  getTask,
  listTasks,
};