const pool = require('../db');
const crypto = require('crypto');

class TaskContext {
  async create({ serverId, action, clientName, password, idempotencyKey, userId }) {
    const taskId = crypto.randomBytes(16).toString('hex');
    const result = await pool.query(
      'INSERT INTO tasks (task_id, server_id, action, client_name, password, idempotency_key, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [taskId, serverId, action, clientName, password || null, idempotencyKey, userId]
    );
    return result.rows[0];
  }

  async findByIdempotencyKey(idempotencyKey) {
    const result = await pool.query(
      'SELECT task_id, status FROM tasks WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    return result.rows[0] || null;
  }

  async findById(taskId) {
    const result = await pool.query(
      'SELECT t.*, tr.result FROM tasks t LEFT JOIN task_results tr ON t.task_id = tr.task_id WHERE t.task_id = $1',
      [taskId]
    );
    return result.rows[0] || null;
  }

  async getNextForServer(serverId) {
    const result = await pool.query(
      `SELECT task_id, action, client_name, password FROM tasks WHERE server_id = $1 AND status = ANY($2) ORDER BY created_at ASC LIMIT 1`,
      [serverId, ['pending', 'processing']]
    );
    return result.rows[0] || null;
  }

  async updateStatus(taskId, status) {
    await pool.query('UPDATE tasks SET status = $1 WHERE task_id = $2', [status, taskId]);
  }

  async complete(taskId, result) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'UPDATE tasks SET status = $1, completed_at = CURRENT_TIMESTAMP WHERE task_id = $2',
        ['completed', taskId]
      );

      await client.query(
        'INSERT INTO task_results (task_id, result) VALUES ($1, $2)',
        [taskId, JSON.stringify(result)]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async list({ serverId, status, userId }) {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (serverId) {
      paramCount++;
      query += ` AND server_id = $${paramCount}`;
      params.push(serverId);
    }

    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }

    if (userId) {
      paramCount++;
      query += ` AND user_id = $${paramCount}`;
      params.push(userId);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    return result.rows;
  }
}

module.exports = new TaskContext();