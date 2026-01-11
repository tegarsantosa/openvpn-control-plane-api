const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
const config = require('./config');
const passport = require('./config/passport');
const pool = require('./db');
const { startCronJobs } = require('./services/cronService');

const authRoutes = require('./routes/authRoutes');
const clientRoutes = require('./routes/clientRoutes');
const serverRoutes = require('./routes/serverRoutes');
const taskRoutes = require('./routes/taskRoutes');
const { authenticateAdmin } = require('./middleware/auth');

const app = express();

app.use(express.json());
app.set('trust proxy', true);
app.use(passport.initialize());

if (process.env.ENABLE_SWAGGER === 'true') {
  const swaggerDocument = YAML.load(
    path.join(__dirname, '../docs/swagger.yaml')
  );
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/admin/servers', serverRoutes);
app.use('/api/tasks', taskRoutes);

app.get('/health', authenticateAdmin, async (req, res) => {
  try {
    await pool.query('SELECT 1');

    const serversResult = await pool.query('SELECT COUNT(*) FROM servers');
    const clientsResult = await pool.query('SELECT COUNT(*) FROM clients');
    const tasksResult = await pool.query('SELECT COUNT(*) FROM tasks');

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      servers: parseInt(serversResult.rows[0].count),
      clients: parseInt(clientsResult.rows[0].count),
      tasks: parseInt(tasksResult.rows[0].count),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
    });
  }
});

startCronJobs();

module.exports = app;