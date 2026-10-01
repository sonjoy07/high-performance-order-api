import { Router } from 'express';
import { productController } from './product.controller';
import { validateRequest } from '../../common/middleware/validate.middleware';
import {
  createProductSchema,
  updateProductSchema,
  productQuerySchema,
  productIdParamSchema,
} from './product.validation';

const router = Router();

router.post('/', validateRequest({ body: createProductSchema }), productController.create);

router.get('/', validateRequest({ query: productQuerySchema }), productController.list);

router.get('/:id', validateRequest({ params: productIdParamSchema }), productController.getById);

router.patch(
  '/:id',
  validateRequest({
    params: productIdParamSchema,
    body: updateProductSchema,
  }),
  productController.update
);

router.delete('/:id', validateRequest({ params: productIdParamSchema }), productController.delete);

export const productRouter = router;
