const express = require('express');
const { body } = require('express-validator');
const passport = require('../config/passport');
const authController = require('../controllers/authController');
const { authenticateUser, validateRequest } = require('../middleware/auth');

const router = express.Router();

router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').trim().notEmpty().withMessage('Name is required'),
  ],
  validateRequest,
  authController.register
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validateRequest,
  authController.login
);

router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })
);

router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  authController.googleCallback
);

router.get('/verify-email/:token', authController.verifyEmail);

router.post(
  '/resend-verification',
  [body('email').isEmail().withMessage('Valid email is required')],
  validateRequest,
  authController.resendVerification
);

router.get('/me', authenticateUser, authController.getMe);

module.exports = router;