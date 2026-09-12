const { z } = require('zod');

/**
 * Middleware factory that validates request body against a Zod schema.
 */
function validateBody(schema) {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req.body);
      req.body = parsed;
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: err.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      }
      next(err);
    }
  };
}

// Validation schemas
const registerSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(32, 'Username cannot exceed 32 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain alphanumeric characters and underscores'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  cfHandle: z.string()
    .min(2, 'Codeforces handle must be at least 2 characters')
    .max(64, 'Codeforces handle cannot exceed 64 characters')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid Codeforces handle format')
});

const loginSchema = z.object({
  identifier: z.string().min(1, 'Email or username is required').optional(),
  email: z.string().optional(),
  username: z.string().optional(),
  password: z.string().min(1, 'Password is required')
}).refine(data => data.identifier || data.email || data.username, {
  message: 'Must provide either identifier, email, or username'
});

module.exports = {
  validateBody,
  registerSchema,
  loginSchema
};
