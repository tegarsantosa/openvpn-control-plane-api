const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const config = require('../config');
const UserContext = require('../contexts/UserContext');
const ServerContext = require('../contexts/ServerContext');

const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    const user = await UserContext.findById(decoded.user_id);

    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

const authenticateAdmin = async (req, res, next) => {
  await authenticateUser(req, res, () => {
    if (!req.user.is_admin) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
  });
};

const authenticateAgent = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.substring(7);
  const server = await ServerContext.findByAuthToken(token);

  if (!server) {
    return res.status(401).json({ success: false, error: 'Invalid agent token' });
  }

  if (!server.is_active) {
    return res.status(403).json({ success: false, error: 'Server is not active' });
  }

  req.server_id = server.server_id;
  next();
};

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

module.exports = {
  authenticateUser,
  authenticateAdmin,
  authenticateAgent,
  validateRequest,
};