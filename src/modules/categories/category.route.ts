import { Router } from 'express';
import { categoryController } from './category.controller';
import { validateRequest } from '../../common/middleware/validate.middleware';
import {
  createCategorySchema,
  updateCategorySchema,
  categoryQuerySchema,
  categoryIdParamSchema,
} from './category.validation';

const router = Router();

router.post('/', validateRequest({ body: createCategorySchema }), categoryController.create);

router.get('/', validateRequest({ query: categoryQuerySchema }), categoryController.list);

router.get('/:id', validateRequest({ params: categoryIdParamSchema }), categoryController.getById);

router.patch(
  '/:id',
  validateRequest({
    params: categoryIdParamSchema,
    body: updateCategorySchema,
  }),
  categoryController.update
);

router.delete(
  '/:id',
  validateRequest({ params: categoryIdParamSchema }),
  categoryController.delete
);

export const categoryRouter = router;
