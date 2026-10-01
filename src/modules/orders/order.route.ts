import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.middleware';
import { createOrderSchema } from './order.validation';
import { orderController } from './order.controller';
import { authenticate } from '../auth/auth.middleware';

const router = Router();

// Order creation requires authentication (CUSTOMER or ADMIN)
router.post('/', authenticate, validateRequest({ body: createOrderSchema }), orderController.createOrder);

// Order lookup requires authentication and verifies customer ownership (IDOR prevention)
router.get('/:id', authenticate, orderController.getOrderById);

export const orderRouter = router;
