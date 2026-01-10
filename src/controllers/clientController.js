const crypto = require('crypto');
const pool = require('../db');
const UserContext = require('../contexts/UserContext');
const ServerContext = require('../contexts/ServerContext');
const ClientContext = require('../contexts/ClientContext');
const TaskContext = require('../contexts/TaskContext');

const createClient = async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, password, server_id } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];

    if (!idempotencyKey) {
      return res.status(400).json({ success: false, error: 'idempotency-key header is required' });
    }

    const isExpired = await UserContext.isTrialExpired(req.user);
    if (isExpired) {
      return res.status(403).json({
        success: false,
        error: 'Your free trial has expired. Please upgrade to continue using the service.',
      });
    }

    const clientLimit = await UserContext.getVpnClientLimit(req.user);
    const clientCount = await ClientContext.countByUser(req.user.id);

    if (clientCount >= clientLimit) {
      return res.status(403).json({
        success: false,
        error: `You have reached your VPN client limit (${clientLimit}). Please upgrade to create more clients.`,
      });
    }

    const server = await ServerContext.findByServerId(server_id);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    if (!server.is_active) {
      return res.status(400).json({ success: false, error: 'Server is not active' });
    }

    const existingTask = await TaskContext.findByIdempotencyKey(idempotencyKey);
    if (existingTask) {
      const clientResult = await pool.query(
        'SELECT vpn_id FROM clients WHERE name = $1 AND server_id = $2',
        [name, server_id]
      );

      return res.status(200).json({
        success: true,
        message: 'Task already exists',
        task_id: existingTask.task_id,
        status: existingTask.status,
        vpn_id: clientResult.rows.length > 0 ? clientResult.rows[0].vpn_id : null,
        server_id,
      });
    }

    const timestamp = Date.now();
    const sanitizedName = name.replace(/\s+/g, '-').toLowerCase();
    const vpnName = `${sanitizedName}-${server_id}-${timestamp}`;
    const vpnId = crypto.randomBytes(16).toString('hex');

    await client.query('BEGIN');

    await ClientContext.create({
      vpnId,
      name,
      vpnName,
      serverId: server_id,
      userId: req.user.id,
    });

    const task = await TaskContext.create({
      serverId: server_id,
      action: 'create',
      clientName: vpnName,
      password,
      idempotencyKey,
      userId: req.user.id,
    });

    await client.query('COMMIT');

    res.status(202).json({
      success: true,
      message: 'Task queued',
      task_id: task.task_id,
      vpn_id: vpnId,
      server_id,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating client:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
};

const deleteClient = async (req, res) => {
  try {
    const { vpn_id } = req.params;
    const idempotencyKey = req.headers['idempotency-key'];

    if (!idempotencyKey) {
      return res.status(400).json({ success: false, error: 'idempotency-key header is required' });
    }

    const clientData = await ClientContext.findByVpnId(vpn_id);
    if (!clientData) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    if (clientData.user_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const server = await ServerContext.findByServerId(clientData.server_id);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    if (!server.is_active) {
      return res.status(400).json({ success: false, error: 'Server is not active' });
    }

    const existingTask = await TaskContext.findByIdempotencyKey(idempotencyKey);
    if (existingTask) {
      return res.status(200).json({
        success: true,
        message: 'Task already exists',
        task_id: existingTask.task_id,
        status: existingTask.status,
        server_id: clientData.server_id,
      });
    }

    const task = await TaskContext.create({
      serverId: clientData.server_id,
      action: 'revoke',
      clientName: clientData.vpn_name,
      idempotencyKey,
      userId: req.user.id,
    });

    res.status(202).json({
      success: true,
      message: 'Task queued',
      task_id: task.task_id,
      server_id: clientData.server_id,
    });
  } catch (error) {
    console.error('Error revoking client:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const listClients = async (req, res) => {
  try {
    const { server_id } = req.query;

    const clients = await ClientContext.list({
      userId: req.user.id,
      serverId: server_id,
      isAdmin: req.user.is_admin,
    });

    res.json({
      success: true,
      clients,
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const getClientConfig = async (req, res) => {
  try {
    const { vpn_id } = req.params;

    const clientData = await ClientContext.findByVpnId(vpn_id);
    if (!clientData) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    if (!req.user.is_admin && clientData.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    if (!clientData.config) {
      return res.status(404).json({ success: false, error: 'Config not yet generated' });
    }

    const configContent = Buffer.from(clientData.config, 'base64').toString('utf8');
    res.setHeader('Content-Type', 'application/x-openvpn-profile');
    res.setHeader('Content-Disposition', `attachment; filename="${clientData.name}.ovpn"`);
    res.send(configContent);
  } catch (error) {
    console.error('Error fetching client config:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

module.exports = {
  createClient,
  deleteClient,
  listClients,
  getClientConfig,
};