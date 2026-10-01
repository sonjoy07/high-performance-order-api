import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { productController } from './product.controller';
import { validateRequest } from '../../common/middleware/validate.middleware';
import { authenticate, requireRole } from '../auth/auth.middleware';
import {
  createProductSchema,
  updateProductSchema,
  productQuerySchema,
  productIdParamSchema,
} from './product.validation';

const router = Router();

// Public endpoints
router.get('/', validateRequest({ query: productQuerySchema }), productController.list);
router.get('/:id', validateRequest({ params: productIdParamSchema }), productController.getById);

// Admin-only management endpoints
router.post(
  '/',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ body: createProductSchema }),
  productController.create
);

router.patch(
  '/:id',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({
    params: productIdParamSchema,
    body: updateProductSchema,
  }),
  productController.update
);

router.delete(
  '/:id',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: productIdParamSchema }),
  productController.delete
);

export const productRouter = router;
