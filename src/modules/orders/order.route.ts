import { Router } from 'express';
import { validateRequest } from '../../common/middleware/validate.middleware';
import { createOrderSchema } from './order.validation';
import { orderController } from './order.controller';

const router = Router();

router.post('/', validateRequest({ body: createOrderSchema }), orderController.createOrder);

export const orderRouter = router;
