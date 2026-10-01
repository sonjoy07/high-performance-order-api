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

  // 4. Create Customer Users & Customer Profiles
  console.log('Creating Customer Users & Profiles...');
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
    ` Created customer 1: ${customerUser1.email} (${customerUser1.customer?.firstName} ${customerUser1.customer?.lastName})`
  );

  const customerUser2 = await prisma.user.create({
    data: {
      email: 'jane.smith@example.com',
      passwordHash: customerPasswordHash,
      role: UserRole.CUSTOMER,
      customer: {
        create: {
          firstName: 'Jane',
          lastName: 'Smith',
          phone: '+1-555-0102',
        },
      },
    },
    include: { customer: true },
  });
  console.log(
    ` Created customer 2: ${customerUser2.email} (${customerUser2.customer?.firstName} ${customerUser2.customer?.lastName})`
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

  const booksStationery = await prisma.category.create({
    data: {
      name: 'Books & Stationery',
      slug: 'books-stationery',
      description: 'Technical literature, notebooks, and premium writing instruments',
    },
  });

  console.log(' Created 3 categories: Electronics, Home & Kitchen, Books & Stationery');

  // 6. Create Products with Inventory and Initial Stock Movement
  console.log('Creating Products, Inventories, and Audit Movements...');
  const productsData = [
    // Electronics
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
      stock: 75,
    },
    {
      categoryId: electronics.id,
      name: 'Ultra-Wide 34-inch 144Hz Gaming Monitor',
      slug: 'ultra-wide-34-inch-144hz-gaming-monitor',
      description: 'Curved WQHD IPS display with HDR400 and AMD FreeSync Premium.',
      sku: 'TECH-UWM-003',
      price: '649.99',
      stock: 35,
    },

    // Home & Kitchen
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
    {
      categoryId: homeKitchen.id,
      name: 'Autonomous Robot Vacuum & Sonic Mop',
      slug: 'autonomous-robot-vacuum-sonic-mop',
      description: 'LiDAR precision navigation with auto-emptying dustbin and sonic scrubbing.',
      sku: 'HOME-RVM-003',
      price: '399.95',
      stock: 45,
    },

    // Books & Stationery
    {
      categoryId: booksStationery.id,
      name: 'Designing Data-Intensive Applications',
      slug: 'designing-data-intensive-applications',
      description:
        'The definitive guide to distributed systems, scalability, and data reliability.',
      sku: 'BOOK-DDIA-001',
      price: '49.99',
      stock: 150,
    },
    {
      categoryId: booksStationery.id,
      name: 'Hardcover Dot-Grid Technical Notebook',
      slug: 'hardcover-dot-grid-technical-notebook',
      description: '160gsm bleed-proof bamboo paper notebook with dual bookmarks and index.',
      sku: 'STAT-HDTN-002',
      price: '24.95',
      stock: 200,
    },
    {
      categoryId: booksStationery.id,
      name: 'Precision Fountain Pen Executive Set',
      slug: 'precision-fountain-pen-executive-set',
      description:
        'Handcrafted titanium nib fountain pen with converter and archived black ink bottle.',
      sku: 'STAT-PFPE-003',
      price: '85.00',
      stock: 65,
    },
  ];

  for (const item of productsData) {
    const product = await prisma.product.create({
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
      include: {
        inventory: true,
      },
    });

    console.log(
      ` Created product: ${product.name} [SKU: ${product.sku}, Stock: ${product.inventory?.quantity}, Price: $${product.price}]`
    );
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
