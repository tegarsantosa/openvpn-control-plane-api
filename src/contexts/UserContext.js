const pool = require('../db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

class UserContext {
  async findByEmail(email) {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] || null;
  }

  async findById(id) {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async create({ email, name, password, isVerified = false }) {
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;
    const result = await pool.query(
      'INSERT INTO users (email, name, password, is_verified, verified_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [email, name, hashedPassword, isVerified, isVerified ? new Date() : null]
    );
    return result.rows[0];
  }

  async verify(userId) {
    const result = await pool.query(
      'UPDATE users SET is_verified = $1, verified_at = $2 WHERE id = $3 RETURNING *',
      [true, new Date(), userId]
    );
    return result.rows[0];
  }

  async comparePassword(password, hashedPassword) {
    return bcrypt.compare(password, hashedPassword);
  }

  async createEmailVerification(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await pool.query(
      'INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [userId, token, expiresAt]
    );
    
    return token;
  }

  async findEmailVerification(token) {
    const result = await pool.query(
      'SELECT user_id, expires_at FROM email_verifications WHERE token = $1',
      [token]
    );
    return result.rows[0] || null;
  }

  async deleteEmailVerifications(userId) {
    await pool.query('DELETE FROM email_verifications WHERE user_id = $1', [userId]);
  }

  async findOrCreateSSOUser({ email, name, provider, providerUserId }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let user = await this.findByEmail(email);

      if (!user) {
        const result = await client.query(
          'INSERT INTO users (email, name, is_verified, verified_at) VALUES ($1, $2, $3, $4) RETURNING *',
          [email, name, true, new Date()]
        );
        user = result.rows[0];
      } else if (!user.is_verified) {
        const result = await client.query(
          'UPDATE users SET is_verified = $1, verified_at = $2 WHERE id = $3 RETURNING *',
          [true, new Date(), user.id]
        );
        user = result.rows[0];
      }

      const ssoResult = await client.query(
        'SELECT * FROM user_ssos WHERE user_id = $1 AND provider = $2',
        [user.id, provider]
      );

      if (ssoResult.rows.length === 0) {
        await client.query(
          'INSERT INTO user_ssos (user_id, provider, provider_user_id) VALUES ($1, $2, $3)',
          [user.id, provider, providerUserId]
        );
      }

      await client.query('COMMIT');
      return user;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async checkCooldown(userId) {
    const result = await pool.query(
      `SELECT created_at FROM email_verifications WHERE user_id = $1 AND created_at > NOW() - INTERVAL '3 minutes'`,
      [userId]
    );
    return result.rows.length > 0;
  }

  async getSettings() {
    const result = await pool.query('SELECT data FROM settings ORDER BY id DESC LIMIT 1');
    return result.rows[0]?.data || null;
  }

  async isTrialExpired(user) {
    if (!user.verified_at || user.is_paid) {
      return false;
    }

    const settings = await this.getSettings();
    if (!settings?.user?.free_minutes) {
      return false;
    }

    const verifiedAt = new Date(user.verified_at);
    const freeMinutes = settings.user.free_minutes;
    const expiresAt = new Date(verifiedAt.getTime() + freeMinutes * 60 * 1000);

    return new Date() > expiresAt;
  }

  async getVpnClientLimit(user) {
    if (!user.is_verified) {
      return 0;
    }

    const settings = await this.getSettings();
    if (!settings?.user) {
      return 0;
    }

    if (user.is_paid) {
      return settings.user.paid_vpn_client_count || 5;
    }

    const isExpired = await this.isTrialExpired(user);
    if (isExpired) {
      return 0;
    }

    return settings.user.free_vpn_client_count || 1;
  }

  async getUserClientCount(userId) {
    const result = await pool.query('SELECT COUNT(*) FROM clients WHERE user_id = $1', [userId]);
    return parseInt(result.rows[0].count);
  }
}

module.exports = new UserContext();