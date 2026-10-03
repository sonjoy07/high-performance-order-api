import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'High Performance Order API',
      version: '1.0.0',
      description: 'REST API for order management system',
    },
    servers: [
      {
        url: '/api/v1',
        description: 'API v1',
      },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Categories', description: 'Category management' },
      { name: 'Products', description: 'Product management' },
      { name: 'Inventory', description: 'Inventory management' },
      { name: 'Orders', description: 'Order management' },
      { name: 'Reports', description: 'Reporting (Admin only)' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/**/*.ts', './dist/**/*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
