const pool = require('../db');
const crypto = require('crypto');

class ClientContext {
  async create({ vpnId, name, vpnName, serverId, userId }) {
    const result = await pool.query(
      'INSERT INTO clients (vpn_id, name, vpn_name, server_id, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [vpnId, name, vpnName, serverId, userId]
    );
    return result.rows[0];
  }

  async findByVpnId(vpnId) {
    const result = await pool.query(
      'SELECT vpn_name, server_id, user_id, name, config FROM clients WHERE vpn_id = $1',
      [vpnId]
    );
    return result.rows[0] || null;
  }

  async updateConfig(vpnName, serverId, config) {
    await pool.query(
      'UPDATE clients SET config = $1 WHERE vpn_name = $2 AND server_id = $3',
      [config, vpnName, serverId]
    );
  }

  async deleteByVpnName(vpnName, serverId) {
    await pool.query('DELETE FROM clients WHERE vpn_name = $1 AND server_id = $2', [vpnName, serverId]);
  }

  async list({ userId, serverId, isAdmin }) {
    let query = 'SELECT vpn_id, name, vpn_name, server_id, created_at FROM clients';
    const params = [];

    if (!isAdmin) {
      query += ' WHERE user_id = $1';
      params.push(userId);

      if (serverId) {
        query += ' AND server_id = $2';
        params.push(serverId);
      }
    } else {
      if (serverId) {
        query += ' WHERE server_id = $1';
        params.push(serverId);
      }
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    return result.rows;
  }

  async countByUser(userId) {
    const result = await pool.query('SELECT COUNT(*) FROM clients WHERE user_id = $1', [userId]);
    return parseInt(result.rows[0].count);
  }

  async listByUser(userId) {
    const result = await pool.query(
      'SELECT vpn_id, vpn_name, server_id FROM clients WHERE user_id = $1',
      [userId]
    );
    return result.rows;
  }

  async revokeAllByUser(userId) {
    const clients = await this.listByUser(userId);
    const tasks = [];

    for (const client of clients) {
      const taskId = crypto.randomBytes(16).toString('hex');
      const idempotencyKey = crypto.randomBytes(16).toString('hex');

      await pool.query(
        'INSERT INTO tasks (task_id, server_id, action, client_name, idempotency_key, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [taskId, client.server_id, 'revoke', client.vpn_name, idempotencyKey, userId]
      );

      tasks.push(taskId);
    }

    return tasks;
  }
}

module.exports = new ClientContext();