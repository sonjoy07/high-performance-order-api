import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { categoryController } from './category.controller';
import { validateRequest } from '../../common/middleware/validate.middleware';
import { authenticate, requireRole } from '../auth/auth.middleware';
import {
  createCategorySchema,
  updateCategorySchema,
  categoryQuerySchema,
  categoryIdParamSchema,
} from './category.validation';

const router = Router();

// Public endpoints
router.get('/', validateRequest({ query: categoryQuerySchema }), categoryController.list);
router.get('/:id', validateRequest({ params: categoryIdParamSchema }), categoryController.getById);

// Admin-only management endpoints
router.post(
  '/',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ body: createCategorySchema }),
  categoryController.create
);

router.patch(
  '/:id',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({
    params: categoryIdParamSchema,
    body: updateCategorySchema,
  }),
  categoryController.update
);

router.delete(
  '/:id',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: categoryIdParamSchema }),
  categoryController.delete
);

export const categoryRouter = router;
