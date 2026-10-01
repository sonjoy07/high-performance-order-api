import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { inventoryController } from './inventory.controller';
import { validateRequest } from '../../common/middleware/validate.middleware';
import { authenticate, requireRole } from '../auth/auth.middleware';
import {
  inventoryParamSchema,
  adjustInventorySchema,
  inventoryMovementQuerySchema,
} from './inventory.validation';

const router = Router();

// Inventory management endpoints (restricted to ADMIN)
router.get(
  '/:productId',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({ params: inventoryParamSchema }),
  inventoryController.getByProductId
);

router.post(
  '/:productId/adjust',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({
    params: inventoryParamSchema,
    body: adjustInventorySchema,
  }),
  inventoryController.adjustStock
);

router.get(
  '/:productId/movements',
  authenticate,
  requireRole(UserRole.ADMIN),
  validateRequest({
    params: inventoryParamSchema,
    query: inventoryMovementQuerySchema,
  }),
  inventoryController.getMovements
);

export const inventoryRouter = router;
