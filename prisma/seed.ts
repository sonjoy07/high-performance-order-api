import { PrismaClient, UserRole, InventoryMovementType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/order_api';

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting database seed...');

  // 1. Clean existing records in reverse dependency order
  console.log('Cleaning existing records...');
  await prisma.stockReservation.deleteMany();
  await prisma.orderStatusHistory.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.inventoryMovement.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();

  // 2. Hash passwords
  const salt = await bcrypt.genSalt(10);
  const adminPasswordHash = await bcrypt.hash('AdminPassword123!', salt);
  const customerPasswordHash = await bcrypt.hash('CustomerPassword123!', salt);

  // 3. Create Admin User
  console.log('Creating Admin User...');
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@orderapi.com',
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN,
    },
  });
  console.log(` Created admin user: ${adminUser.email}`);

  // 4. Create Customer User & Profile
  console.log('Creating Customer User & Profile...');
  const customerUser1 = await prisma.user.create({
    data: {
      email: 'john.doe@example.com',
      passwordHash: customerPasswordHash,
      role: UserRole.CUSTOMER,
      customer: {
        create: {
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1-555-0101',
        },
      },
    },
    include: { customer: true },
  });
  console.log(
    ` Created customer: ${customerUser1.email} (${customerUser1.customer?.firstName} ${customerUser1.customer?.lastName})`
  );

  // 5. Create Categories
  console.log('Creating Categories...');
  const electronics = await prisma.category.create({
    data: {
      name: 'Electronics',
      slug: 'electronics',
      description: 'Computing devices, audio equipment, and digital accessories',
    },
  });

  const homeKitchen = await prisma.category.create({
    data: {
      name: 'Home & Kitchen',
      slug: 'home-kitchen',
      description: 'Smart appliances, kitchenware, and modern home essentials',
    },
  });
  console.log(' Created 2 categories: Electronics, Home & Kitchen');

  // 6. Create Products with Inventory and Initial Stock Movement
  console.log('Creating Products, Inventories, and Audit Movements...');
  const productsData = [
    {
      categoryId: electronics.id,
      name: 'Wireless Noise-Cancelling Headphones Pro',
      slug: 'wireless-noise-cancelling-headphones-pro',
      description: 'Premium active noise cancellation with 40-hour battery life and Hi-Res audio.',
      sku: 'TECH-WNC-001',
      price: '199.99',
      stock: 120,
    },
    {
      categoryId: electronics.id,
      name: 'Ergonomic Mechanical Keyboard (Brown Switch)',
      slug: 'ergonomic-mechanical-keyboard-brown-switch',
      description: 'Hot-swappable RGB backlit mechanical keyboard with ergonomic wrist rest.',
      sku: 'TECH-EMK-002',
      price: '129.50',
      stock: 10,
    },
    {
      categoryId: homeKitchen.id,
      name: 'Digital Smart Air Fryer XL (6.5L)',
      slug: 'digital-smart-air-fryer-xl-6-5l',
      description: '12-in-1 programmable air fryer with dual heating elements and app control.',
      sku: 'HOME-AFX-001',
      price: '149.99',
      stock: 60,
    },
    {
      categoryId: homeKitchen.id,
      name: 'Compact Espresso Machine 15-Bar',
      slug: 'compact-espresso-machine-15-bar',
      description:
        'Stainless steel manual espresso maker with steam wand for barista-style cappuccino.',
      sku: 'HOME-ESM-002',
      price: '289.00',
      stock: 25,
    },
  ];

  for (const item of productsData) {
    await prisma.product.create({
      data: {
        categoryId: item.categoryId,
        name: item.name,
        slug: item.slug,
        description: item.description,
        sku: item.sku,
        price: item.price,
        isActive: true,
        inventory: {
          create: {
            quantity: item.stock,
            reservedQuantity: 0,
            version: 1,
          },
        },
        inventoryMovements: {
          create: {
            type: InventoryMovementType.STOCK_IN,
            quantity: item.stock,
            referenceType: 'INITIAL_STOCK',
            referenceId: 'SEED-INIT',
          },
        },
      },
    });
  }

  const products = await prisma.product.findMany({ include: { inventory: true } });
  const customer = await prisma.customer.findUnique({
    where: { userId: customerUser1.id },
  });

  if (customer && products.length >= 2) {
    const p1 = products[0];
    const p2 = products[1];

    // Order 1
    await prisma.order.create({
      data: {
        customerId: customer.id,
        orderNumber: 'ORD-SEED-001',
        status: 'CONFIRMED',
        totalAmount: (Number(p1.price) * 2).toFixed(2),
        items: {
          create: [
            {
              productId: p1.id,
              quantity: 2,
              unitPrice: p1.price,
              totalPrice: (Number(p1.price) * 2).toFixed(2),
            },
          ],
        },
        statusHistory: {
          create: [
            { fromStatus: null, toStatus: 'PENDING', changedBy: customerUser1.id },
            { fromStatus: 'PENDING', toStatus: 'CONFIRMED', changedBy: adminUser.id },
          ],
        },
      },
    });

    // Order 2
    const order2 = await prisma.order.create({
      data: {
        customerId: customer.id,
        orderNumber: 'ORD-SEED-002',
        status: 'SHIPPED',
        totalAmount: Number(p2.price).toFixed(2),
        items: {
          create: [
            {
              productId: p2.id,
              quantity: 1,
              unitPrice: p2.price,
              totalPrice: Number(p2.price).toFixed(2),
            },
          ],
        },
        statusHistory: {
          create: [
            { fromStatus: null, toStatus: 'PENDING', changedBy: customerUser1.id },
            { fromStatus: 'PENDING', toStatus: 'CONFIRMED', changedBy: adminUser.id },
            { fromStatus: 'CONFIRMED', toStatus: 'PROCESSING', changedBy: adminUser.id },
            { fromStatus: 'PROCESSING', toStatus: 'SHIPPED', changedBy: adminUser.id },
          ],
        },
      },
    });

    await prisma.inventoryMovement.create({
      data: {
        productId: p2.id,
        type: InventoryMovementType.STOCK_OUT,
        quantity: 1,
        referenceType: 'ORDER',
        referenceId: order2.id,
      },
    });
  }

  console.log('✅ Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during database seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
