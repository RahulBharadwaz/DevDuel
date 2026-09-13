const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { validateBody, registerSchema, loginSchema } = require('../middleware/validate');

// Public endpoints for 2-step verification registration
router.post('/register-step1', authController.registerStep1);
router.post('/verify-cf', authController.verifyCf);
router.post('/register-final', authController.registerFinal);

// Public legacy / direct auth endpoints
router.post('/register', validateBody(registerSchema), authController.register);
router.post('/login', validateBody(loginSchema), authController.login);

// Protected endpoints
router.get('/me', authenticateToken, authController.getMe);

module.exports = router;
