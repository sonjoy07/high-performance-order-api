import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from './auth.middleware';

export const authRouter = Router();

// Public Authentication endpoints
authRouter.post('/register', authController.register);
authRouter.post('/login', authController.login);
authRouter.post('/refresh', authController.refreshToken);

// Protected Authentication endpoints
authRouter.post('/logout', authenticate, authController.logout);
authRouter.get('/me', authenticate, authController.getMe);
