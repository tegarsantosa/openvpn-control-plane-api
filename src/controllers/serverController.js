const ServerContext = require('../contexts/ServerContext');
const TaskContext = require('../contexts/TaskContext');
const ClientContext = require('../contexts/ClientContext');
const { generateAgentScript, generateServiceFile } = require('../services/agentService');

const createServer = async (req, res) => {
  try {
    const { server_id, location_id } = req.body;

    const exists = await ServerContext.exists(server_id);
    if (exists) {
      return res.status(409).json({ success: false, error: 'Server already exists' });
    }

    const locationExists = await ServerContext.locationExists(location_id);
    if (!locationExists) {
      return res.status(404).json({ success: false, error: 'Location not found' });
    }

    const { registrationToken, expiresAt } = await ServerContext.createRegistrationToken({
      serverId: server_id,
      locationId: location_id,
      createdBy: req.user.email,
    });

    res.json({
      success: true,
      server_id,
      registration_token: registrationToken,
      expires_at: expiresAt,
      registration_url: `${req.protocol}://${req.get('host')}/api/servers/register/${registrationToken}`,
    });
  } catch (error) {
    console.error('Error creating server:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const registerServer = async (req, res) => {
  try {
    const { registration_token } = req.params;

    const token = await ServerContext.findRegistrationToken(registration_token);
    if (!token) {
      return res.status(404).json({ success: false, error: 'Invalid registration token' });
    }

    if (token.is_used) {
      return res.status(400).json({ success: false, error: 'Registration token already used' });
    }

    if (new Date(token.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Registration token expired. Please contact admin to generate a new token.',
      });
    }

    const authToken = await ServerContext.registerServer(token.id, token.server_id);
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    res.setHeader('Content-Type', 'text/plain');
    res.send(`
      Server registered successfully!

      Server ID:
        ${token.server_id}

      Next step — run this command on your server

      ------------------------------------------------------------
      curl -fsSL "${baseUrl}/api/servers/agent/install.sh?token=${authToken}" | sudo bash
      ------------------------------------------------------------

      This will:
        • Download the OpenVPN agent
        • Install the systemd service
        • Enable & start the agent automatically

      Notes:
        • Run as a user with sudo access

      `);
  } catch (error) {
    console.error('Error registering server:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const getInstallScript = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(401).send('Missing token');
  }

  const server = await ServerContext.findByAuthToken(token);
  if (!server) {
    return res.status(401).send('Invalid token');
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;

  res.setHeader('Content-Type', 'text/plain');
  res.send(`#!/usr/bin/env bash
      set -euo pipefail

      PUBLIC_IP=$(curl -s ifconfig.me)
      HOSTNAME=$(hostname)

      curl -s -X POST "${baseUrl}/api/servers/agent/update-info" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        -d "{\\"ip\\":\\"$PUBLIC_IP\\",\\"hostname\\":\\"$HOSTNAME\\"}"

      curl -fsSL -H "Authorization: Bearer ${token}" \
        "${baseUrl}/api/servers/agent/script" \
        | tee /usr/local/bin/openvpn-agent.sh > /dev/null

      chmod 755 /usr/local/bin/openvpn-agent.sh

      curl -fsSL -H "Authorization: Bearer ${token}" \
        "${baseUrl}/api/servers/agent/service" \
        | tee /etc/systemd/system/openvpn-agent.service > /dev/null

      systemctl daemon-reload
      systemctl enable openvpn-agent
      systemctl restart openvpn-agent
    `);
};

const updateServerInfo = async (req, res) => {
  try {
    const { hostname, ip } = req.body;

    await ServerContext.updateInfo(req.server_id, { hostname, ip });

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating server info:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const getAgentScript = async (req, res) => {
  const server = await ServerContext.findByServerId(req.server_id);
  if (!server) {
    return res.status(404).json({ success: false, error: 'Server not found' });
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const script = generateAgentScript(baseUrl, server.server_id, server.auth_token);

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="openvpn-agent.sh"');
  res.send(script);
};

const getServiceFile = async (req, res) => {
  const service = generateServiceFile();

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="openvpn-agent.service"');
  res.send(service);
};

const getTasks = async (req, res) => {
  const startTime = Date.now();
  const timeout = 60000;

  const checkForTask = async () => {
    await ServerContext.updateLastSeen(req.server_id);

    const task = await TaskContext.getNextForServer(req.server_id);

    if (task) {
      await TaskContext.updateStatus(task.task_id, 'processing');
      return res.json(task);
    }

    if (Date.now() - startTime < timeout) {
      setTimeout(checkForTask, 1000);
    } else {
      return res.json(null);
    }
  };

  checkForTask();
};

const submitTaskResult = async (req, res) => {
  try {
    const { task_id } = req.params;
    const result = req.body;

    const task = await TaskContext.findById(task_id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    if (task.server_id !== req.server_id) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    await TaskContext.complete(task_id, result);

    if (result.success && task.action === 'create') {
      await ClientContext.updateConfig(task.client_name, req.server_id, result.config);
    }

    if (result.success && task.action === 'revoke') {
      await ClientContext.deleteByVpnName(task.client_name, req.server_id);
    }

    console.log(`Task ${task_id} completed: ${task.action} - ${task.client_name}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error processing task result:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const listServers = async (req, res) => {
  try {
    const servers = await ServerContext.list();

    res.json({
      success: true,
      servers,
    });
  } catch (error) {
    console.error('Error fetching servers:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const getServerDetails = async (req, res) => {
  try {
    const { server_id } = req.params;

    const server = await ServerContext.getDetails(server_id);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    res.json({
      success: true,
      server,
    });
  } catch (error) {
    console.error('Error fetching server:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const regenerateToken = async (req, res) => {
  try {
    const { server_id } = req.params;

    const server = await ServerContext.findByServerId(server_id);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    const newAuthToken = await ServerContext.regenerateAuthToken(server_id);

    res.json({
      success: true,
      server_id,
      auth_token: newAuthToken,
      message: 'Update the agent configuration with the new token and restart the service',
    });
  } catch (error) {
    console.error('Error regenerating token:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const listLocations = async (req, res) => {
  try {
    const locations = await ServerContext.listLocations();

    res.json({
      success: true,
      locations,
    });
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

module.exports = {
  createServer,
  registerServer,
  getInstallScript,
  updateServerInfo,
  getAgentScript,
  getServiceFile,
  getTasks,
  submitTaskResult,
  listServers,
  getServerDetails,
  regenerateToken,
  listLocations,
};