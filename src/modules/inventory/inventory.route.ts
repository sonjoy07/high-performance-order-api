import { Router } from 'express';
import { inventoryController } from './inventory.controller';
import { validateRequest } from '../../common/middleware/validate.middleware';
import {
  inventoryParamSchema,
  adjustInventorySchema,
  inventoryMovementQuerySchema,
} from './inventory.validation';

const router = Router();

router.get(
  '/:productId',
  validateRequest({ params: inventoryParamSchema }),
  inventoryController.getByProductId
);

router.post(
  '/:productId/adjust',
  validateRequest({
    params: inventoryParamSchema,
    body: adjustInventorySchema,
  }),
  inventoryController.adjustStock
);

router.get(
  '/:productId/movements',
  validateRequest({
    params: inventoryParamSchema,
    query: inventoryMovementQuerySchema,
  }),
  inventoryController.getMovements
);

export const inventoryRouter = router;
