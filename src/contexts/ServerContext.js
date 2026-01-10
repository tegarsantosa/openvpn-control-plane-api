const pool = require('../db');
const crypto = require('crypto');

class ServerContext {
  async findByServerId(serverId) {
    const result = await pool.query('SELECT * FROM servers WHERE server_id = $1', [serverId]);
    return result.rows[0] || null;
  }

  async findByAuthToken(authToken) {
    const result = await pool.query(
      'SELECT server_id, is_active FROM servers WHERE auth_token = $1',
      [authToken]
    );
    return result.rows[0] || null;
  }

  async exists(serverId) {
    const result = await pool.query('SELECT server_id FROM servers WHERE server_id = $1', [serverId]);
    return result.rows.length > 0;
  }

  async locationExists(locationId) {
    const result = await pool.query('SELECT id FROM locations WHERE id = $1', [locationId]);
    return result.rows.length > 0;
  }

  async createRegistrationToken({ serverId, locationId, createdBy }) {
    const client = await pool.connect();
    try {
      const registrationToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await client.query('BEGIN');

      const tokenResult = await client.query(
        'INSERT INTO server_registration_tokens (registration_token, expires_at, created_by) VALUES ($1, $2, $3) RETURNING id',
        [registrationToken, expiresAt, createdBy]
      );

      const tokenId = tokenResult.rows[0].id;

      await client.query(
        'INSERT INTO servers (server_id, location_id, server_registration_token_id) VALUES ($1, $2, $3)',
        [serverId, locationId, tokenId]
      );

      await client.query('COMMIT');

      return { registrationToken, expiresAt };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findRegistrationToken(token) {
    const result = await pool.query(
      'SELECT srt.id, s.server_id, srt.is_used, srt.expires_at FROM server_registration_tokens srt JOIN servers s ON s.server_registration_token_id = srt.id WHERE srt.registration_token = $1',
      [token]
    );
    return result.rows[0] || null;
  }

  async registerServer(tokenId, serverId) {
    const client = await pool.connect();
    try {
      const authToken = crypto.randomBytes(32).toString('hex');

      await client.query('BEGIN');

      await client.query(
        'UPDATE servers SET auth_token = $1, is_active = TRUE WHERE server_id = $2',
        [authToken, serverId]
      );

      await client.query(
        'UPDATE server_registration_tokens SET is_used = TRUE, used_at = CURRENT_TIMESTAMP WHERE id = $1',
        [tokenId]
      );

      await client.query('COMMIT');

      return authToken;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateInfo(serverId, { hostname, ip }) {
    await pool.query(
      'UPDATE servers SET hostname = $1, ip = $2, last_seen = CURRENT_TIMESTAMP WHERE server_id = $3',
      [hostname, ip, serverId]
    );
  }

  async updateLastSeen(serverId) {
    await pool.query(
      'UPDATE servers SET last_seen = CURRENT_TIMESTAMP WHERE server_id = $1',
      [serverId]
    );
  }

  async list() {
    const result = await pool.query(`
      SELECT 
        s.*,
        l.country,
        l.country_code,
        COUNT(c.id) as client_count
      FROM servers s
      LEFT JOIN locations l ON s.location_id = l.id
      LEFT JOIN clients c ON s.server_id = c.server_id
      GROUP BY s.id, l.country, l.country_code
      ORDER BY s.created_at DESC
    `);
    return result.rows;
  }

  async getDetails(serverId) {
    const serverResult = await pool.query(
      `SELECT s.*, l.country, l.country_code FROM servers s LEFT JOIN locations l ON s.location_id = l.id WHERE s.server_id = $1`,
      [serverId]
    );

    if (serverResult.rows.length === 0) {
      return null;
    }

    const clientsResult = await pool.query(
      'SELECT vpn_id, name, vpn_name, created_at FROM clients WHERE server_id = $1 ORDER BY created_at DESC',
      [serverId]
    );

    return {
      ...serverResult.rows[0],
      clients: clientsResult.rows,
    };
  }

  async regenerateAuthToken(serverId) {
    const newAuthToken = crypto.randomBytes(32).toString('hex');
    await pool.query('UPDATE servers SET auth_token = $1 WHERE server_id = $2', [newAuthToken, serverId]);
    return newAuthToken;
  }

  async listLocations() {
    const result = await pool.query('SELECT id, country, country_code FROM locations ORDER BY country');
    return result.rows;
  }
}

module.exports = new ServerContext();