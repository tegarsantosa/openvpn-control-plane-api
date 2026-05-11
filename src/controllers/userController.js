const pool = require('../db');
const ClientContext = require('../contexts/ClientContext');

const listVpns = async (req, res) => {
  try {
    const { server_id } = req.query;

    const clients = await ClientContext.list({
      userId: req.user.id,
      serverId: server_id,
      isAdmin: req.user.is_admin,
    });

    // Fetch server details for each client
    const vpnsWithDetails = await Promise.all(
      clients.map(async (client) => {
        const serverResult = await pool.query(
          'SELECT s.hostname, s.ip, l.country, l.country_code FROM servers s LEFT JOIN locations l ON s.location_id = l.id WHERE s.server_id = $1',
          [client.server_id]
        );
        const server = serverResult.rows[0];

        return {
          vpn_id: client.vpn_id,
          name: client.name,
          vpn_name: client.vpn_name,
          server_id: client.server_id,
          server_hostname: server?.hostname || null,
          server_ip: server?.ip || null,
          country: server?.country || null,
          country_code: server?.country_code || null,
          created_at: client.created_at,
        };
      })
    );

    res.json({
      success: true,
      vpns: vpnsWithDetails,
      total: vpnsWithDetails.length,
    });
  } catch (error) {
    console.error('Error fetching VPNs:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const getVpnDetails = async (req, res) => {
  try {
    const { vpn_id } = req.params;

    const clientData = await ClientContext.findByVpnId(vpn_id);
    if (!clientData) {
      return res.status(404).json({ success: false, error: 'VPN not found' });
    }

    if (!req.user.is_admin && clientData.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Fetch server details
    const serverResult = await pool.query(
      'SELECT s.hostname, s.ip, s.is_active, s.last_seen, l.country, l.country_code FROM servers s LEFT JOIN locations l ON s.location_id = l.id WHERE s.server_id = $1',
      [clientData.server_id]
    );
    const server = serverResult.rows[0];

    // Fetch client creation task status
    const taskResult = await pool.query(
      'SELECT task_id, status, created_at, completed_at FROM tasks WHERE client_name = $1 AND action = $2 ORDER BY created_at DESC LIMIT 1',
      [clientData.vpn_name, 'create']
    );
    const task = taskResult.rows[0];

    res.json({
      success: true,
      vpn: {
        vpn_id,
        name: clientData.name,
        vpn_name: clientData.vpn_name,
        server_id: clientData.server_id,
        server_hostname: server?.hostname || null,
        server_ip: server?.ip || null,
        server_is_active: server?.is_active || false,
        server_last_seen: server?.last_seen || null,
        country: server?.country || null,
        country_code: server?.country_code || null,
        config_available: !!clientData.config,
        task_status: task?.status || null,
        task_id: task?.task_id || null,
        task_created_at: task?.created_at || null,
        task_completed_at: task?.completed_at || null,
      },
    });
  } catch (error) {
    console.error('Error fetching VPN details:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

module.exports = {
  listVpns,
  getVpnDetails,
};
