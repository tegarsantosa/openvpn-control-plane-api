const jwt = require('jsonwebtoken');
const config = require('../config');
const UserContext = require('../contexts/UserContext');
const { sendVerificationEmail } = require('../services/emailService');
const pool = require('../db');

const register = async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, password, name } = req.body;

    const existingUser = await UserContext.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({ success: false, error: 'Email already registered' });
    }

    await client.query('BEGIN');

    const user = await UserContext.create({ email, name, password });
    const verificationToken = await UserContext.createEmailVerification(user.id);
    await sendVerificationEmail(email, verificationToken);

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email to verify your account.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during registration:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await UserContext.findByEmail(email);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    if (!user.password) {
      return res.status(401).json({
        success: false,
        error: 'This account uses social login. Please login with Google.',
      });
    }

    const isValidPassword = await UserContext.comparePassword(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        success: false,
        error: 'Email not verified. Please check your email for verification link.',
      });
    }

    const isExpired = await UserContext.isTrialExpired(user);
    if (isExpired) {
      return res.status(403).json({
        success: false,
        error: 'Your free trial has expired. Please upgrade to continue using the service.',
      });
    }

    const token = jwt.sign({ user_id: user.id, email: user.email }, config.jwt.secret, {
      expiresIn: config.jwt.expiration,
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        is_admin: user.is_admin,
      },
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

const googleCallback = (req, res) => {
  const token = jwt.sign({ user_id: req.user.id, email: req.user.email }, config.jwt.secret, {
    expiresIn: config.jwt.expiration,
  });

  res.json({
    success: true,
    token,
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      is_admin: req.user.is_admin,
    },
  });
};

const verifyEmail = async (req, res) => {
  const client = await pool.connect();
  try {
    const { token } = req.params;

    const verification = await UserContext.findEmailVerification(token);
    if (!verification) {
      return res.status(404).json({ success: false, error: 'Invalid verification token' });
    }

    if (new Date(verification.expires_at) < new Date()) {
      return res.status(400).json({ success: false, error: 'Verification token expired' });
    }

    await client.query('BEGIN');

    await UserContext.verify(verification.user_id);
    await UserContext.deleteEmailVerifications(verification.user_id);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Email verified successfully. You can now login.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error verifying email:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
};

const resendVerification = async (req, res) => {
  const client = await pool.connect();
  try {
    const { email } = req.body;

    const user = await UserContext.findByEmail(email);
    if (!user) {
      return res.json({
        success: true,
        message: 'If the email exists, a verification link has been sent.',
      });
    }

    if (user.is_verified) {
      return res.status(400).json({
        success: false,
        error: 'Email already verified',
      });
    }

    await client.query('BEGIN');

    const cooldownCheck = await client.query(
      `SELECT created_at FROM email_verifications WHERE user_id = $1 AND created_at > NOW() - INTERVAL '3 minutes' FOR UPDATE`,
      [user.id]
    );

    if (cooldownCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(429).json({
        success: false,
        error: 'Please wait 3 minutes before requesting another verification email.',
      });
    }

    await UserContext.deleteEmailVerifications(user.id);
    const token = await UserContext.createEmailVerification(user.id);
    await sendVerificationEmail(email, token);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error resending verification:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  } finally {
    client.release();
  }
};

const getMe = async (req, res) => {
  try {
    const clientLimit = await UserContext.getVpnClientLimit(req.user);
    const clientCount = await UserContext.getUserClientCount(req.user.id);

    res.json({
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        is_admin: req.user.is_admin,
        is_verified: req.user.is_verified,
        is_paid: req.user.is_paid,
        vpn_client_limit: clientLimit,
        vpn_client_count: clientCount,
      },
    });
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

module.exports = {
  register,
  login,
  googleCallback,
  verifyEmail,
  resendVerification,
  getMe,
};