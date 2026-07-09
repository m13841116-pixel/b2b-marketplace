import express from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

import dotenv from 'dotenv';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execSync } from 'child_process';
import { createServer as createViteServer } from 'vite';

// Load environment variables
dotenv.config();

const rootDir = process.cwd();

// Ensure Prisma database file and directory exist
const dbDir = path.join(rootDir, 'prisma');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'dev.db');
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, '');
}
const dbUrl = `file:///${dbPath.replace(/^\//, '')}`;
process.env.DATABASE_URL = dbUrl;

try {
  console.log('Synchronizing database schema...');
  // Force Prisma to use our absolute path
  execSync('npx prisma db push --accept-data-loss', { 
    stdio: 'inherit', 
    env: { ...process.env, DATABASE_URL: dbUrl } 
  });
  console.log('Database synchronization completed.');
} catch (error) {
  console.error('Database synchronization failed:', error);
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'marketplace-super-jwt-secret-key-2026';

// Validation helpers
const IRANIAN_MOBILE_REGEX = /^09\d{9}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Shaba (IBAN) mathematical validation
function formatAndValidateShaba(input: string): { isValid: boolean; formatted?: string; error?: string } {
  // Remove spaces and dashes
  let clean = input.toUpperCase().replace(/[\s-]/g, '');
  
  // If user entered IR, we process it. Otherwise, add IR.
  if (!clean.startsWith('IR')) {
    clean = 'IR' + clean;
  }
  
  const numericPart = clean.substring(2);
  
  if (numericPart.length !== 24 || !/^\d{24}$/.test(numericPart)) {
    return { isValid: false, error: 'شماره شبا باید دقیقاً شامل ۲۴ رقم عددی باشد.' };
  }
  
  return { isValid: true, formatted: clean };
}

// Seed Super Admin on startup
async function seedSuperAdmin() {
  try {
    const existingAdmin = await prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' }
    });
    
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('admin_password123', 10);
      await prisma.user.create({
        data: {
          username: 'admin',
          email: 'admin@marketplace.com',
          password: hashedPassword,
          role: 'SUPER_ADMIN',
          firstName: 'مدیر',
          lastName: 'کل',
          mobile: '09120000000'
        }
      });
      console.log('✅ Super Admin created successfully!');
      console.log('   Username: admin');
      console.log('   Password: admin_password123');
    }
  } catch (error) {
    console.error('Error seeding Super Admin:', error);
  }
}

// Routes
// 1. Register Supplier (تامین کننده)
app.post('/api/auth/register/supplier', async (req, res) => {
  try {
    const {
      username,
      password,
      firstName,
      lastName,
      mobile,
      email,
      nationalCode,
      brandName,
      activityType,
      address,
      province,
      city,
      postalCode,
      telephone,
      website,
      accountHolderName,
      shaba,
      bankName,
      agreementAccepted,
      agreementVersion,
      agreementAcceptedAt
    } = req.body;

    // Field Validations
    if (!username || !password || !firstName || !lastName || !mobile) {
      return res.status(400).json({ error: 'لطفاً فیلدهای اجباری (نام، نام خانوادگی، موبایل، نام کاربری و رمز عبور) را وارد کنید.' });
    }

    if (!USERNAME_REGEX.test(username)) {
      return res.status(400).json({ error: 'نام کاربری فقط میتواند شامل حروف انگلیسی، اعداد و خط تیره (_) باشد.' });
    }

    if (!IRANIAN_MOBILE_REGEX.test(mobile)) {
      return res.status(400).json({ error: 'شماره موبایل وارد شده معتبر نیست. باید با 09 شروع شده و ۱۱ رقم باشد.' });
    }

    if (email && !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'آدرس ایمیل وارد شده معتبر نیست.' });
    }

    const shabaValidation = formatAndValidateShaba(shaba || '');
    if (!shabaValidation.isValid) {
      return res.status(400).json({ error: shabaValidation.error });
    }
    const finalShaba = shabaValidation.formatted;

    if (!agreementAccepted) {
      return res.status(400).json({ error: 'پذیرش قوانین و مقررات الزامی است.' });
    }

    // Check unique username
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ error: 'این نام کاربری قبلاً در سیستم ثبت شده است.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save to DB
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: 'SUPPLIER',
        status: 'ACTIVE_NEW',
        firstName,
        lastName,
        mobile,
        email: email || null,
        nationalCode,
        brandName,
        activityType,
        address,
        province,
        city,
        postalCode,
        telephone,
        website,
        accountHolderName,
        shaba: finalShaba,
        bankName,
        agreementAccepted,
        agreementVersion,
        agreementAcceptedAt: agreementAcceptedAt ? new Date(agreementAcceptedAt) : new Date()
      }
    });

    // Issue JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role, status: user.status },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPassword } = user;
    return res.status(201).json({
      message: 'ثبتنام تامینکننده با موفقیت انجام شد.',
      token,
      user: userWithoutPassword
    });

  } catch (error: any) {
    console.error('Error in supplier registration:', error);
    return res.status(500).json({ error: error.message || 'خطایی در ثبتنام رخ داد. لطفاً مجدداً تلاش کنید.' });
  }
});

// 2. Register Store Manager (مدیر فروشگاه)
app.post('/api/auth/register/store-manager', async (req, res) => {
  try {
    const {
      username,
      password,
      firstName,
      lastName,
      mobile,
      email,
      storeName,
      storeUrl,
      platformType,
      fieldOfActivity,
      productCount
    } = req.body;

    // Field Validations
    if (!username || !password || !firstName || !lastName || !mobile || !storeName) {
      return res.status(400).json({ error: 'لطفاً فیلدهای اجباری (نام، نام خانوادگی، موبایل، نام فروشگاه، نام کاربری و رمز عبور) را وارد کنید.' });
    }

    if (!USERNAME_REGEX.test(username)) {
      return res.status(400).json({ error: 'نام کاربری فقط میتواند شامل حروف انگلیسی، اعداد و خط تیره (_) باشد.' });
    }

    if (!IRANIAN_MOBILE_REGEX.test(mobile)) {
      return res.status(400).json({ error: 'شماره موبایل وارد شده معتبر نیست. باید با 09 شروع شده و ۱۱ رقم باشد.' });
    }

    if (email && !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'آدرس ایمیل وارد شده معتبر نیست.' });
    }

    // Check unique username
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ error: 'این نام کاربری قبلاً در سیستم ثبت شده است.' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save to DB
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: 'STORE_MANAGER',
        firstName,
        lastName,
        mobile,
        email: email || null,
        storeName,
        storeUrl,
        platformType,
        fieldOfActivity,
        productCount: productCount ? parseInt(productCount) : null
      }
    });

    // Issue JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPassword } = user;
    return res.status(201).json({
      message: 'ثبتنام مدیر فروشگاه با موفقیت انجام شد.',
      token,
      user: userWithoutPassword
    });

  } catch (error: any) {
    console.error('Error in store manager registration:', error);
    return res.status(500).json({ error: 'خطایی در ثبتنام رخ داد. لطفاً مجدداً تلاش کنید.' });
  }
});

// 3. Login Endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'لطفاً نام کاربری و کلمه عبور را وارد کنید.' });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: 'نام کاربری یا کلمه عبور نادرست است.' });
    }

    // Verify Password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'نام کاربری یا کلمه عبور نادرست است.' });
    }

    // Check Supplier status if Supplier
    if (user.role === 'SUPPLIER' && user.status === 'BLOCKED') {
      return res.status(403).json({ error: 'حساب کاربری شما مسدود شده است. لطفا با پشتیبانی تماس بگیرید.' });
    }

    // Issue JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role, status: user.status },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...userWithoutPassword } = user;
    return res.json({
      message: 'ورود با موفقیت انجام شد.',
      token,
      user: userWithoutPassword
    });

  } catch (error: any) {
    console.error('Error in login:', error);
    return res.status(500).json({ error: 'خطایی در ورود رخ داد. لطفاً مجدداً تلاش کنید.' });
  }
});

// --- Auth Middleware ---
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token == null) return res.status(401).json({ error: 'عدم دسترسی' });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'توکن نامعتبر است' });
    req.user = user;
    next();
  });
};

const requireSupplier = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'SUPPLIER') {
    return res.status(403).json({ error: 'فقط تامینکنندگان دسترسی دارند' });
  }
  next();
};

// --- Supplier API Routes ---
// Get products for the logged in supplier
app.get('/api/supplier/products', authenticateToken, requireSupplier, async (req: any, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { supplierId: req.user.userId },
      include: { category: true, images: true, variants: true },
      orderBy: { id: 'desc' }
    });
    res.json(products);
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت محصولات' });
  }
});

// Add a new product
app.post('/api/supplier/products', authenticateToken, requireSupplier, async (req: any, res) => {
  try {
    const { categoryId, name, shortDescription, longDescription, supplierBasePrice, discount, sku, brand, stock, images, mainImage, variants } = req.body;
    
    let actualCategoryId = parseInt(categoryId);
    if (actualCategoryId) {
      const categoryExists = await prisma.category.findUnique({ where: { id: actualCategoryId } });
      if (!categoryExists) {
        await prisma.category.create({
          data: { id: actualCategoryId, name: 'دسته‌بندی ' + actualCategoryId, isActive: true, sortOrder: 0 }
        });
      }
    } else {
      const firstCategory = await prisma.category.findFirst();
      if (firstCategory) {
        actualCategoryId = firstCategory.id;
      } else {
        const newCategory = await prisma.category.create({
          data: { name: 'عمومی', isActive: true, sortOrder: 0 }
        });
        actualCategoryId = newCategory.id;
      }
    }

    const product = await prisma.product.create({
      data: {
        supplierId: req.user.userId,
        categoryId: actualCategoryId,
        name,
        shortDescription,
        longDescription,
        supplierBasePrice: parseFloat(supplierBasePrice),
        discount: parseFloat(discount) || 0,
        sku,
        brand,
        status: 'PENDING_APPROVAL', // Start as pending
        images: {
          create: [
            ...(mainImage ? [{ url: mainImage }] : []),
            ...(images || []).map((url: string) => ({ url }))
          ]
        },
        variants: {
          create: (variants && variants.length > 0) ? variants.map((v: any) => ({
            attributes: JSON.stringify(v.attributes),
            supplierBasePrice: parseFloat(v.supplierBasePrice || supplierBasePrice),
            stock: parseInt(v.stock || 0),
            sku: v.sku || sku
          })) : [{
            attributes: JSON.stringify({}),
            supplierBasePrice: parseFloat(supplierBasePrice),
            stock: parseInt(stock || 0),
            sku: sku || ''
          }]
        }
      }
    });
    res.status(201).json({ message: 'محصول با موفقیت ثبت شد', product });
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در ثبت محصول', details: err.message });
  }
});

// Edit a product
app.put('/api/supplier/products/:id', authenticateToken, requireSupplier, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { categoryId, name, shortDescription, longDescription, supplierBasePrice, discount, sku, brand, stock, images, mainImage, variants } = req.body;
    
    // Ensure product belongs to supplier
    const existing = await prisma.product.findFirst({
      where: { id: parseInt(id), supplierId: req.user.userId }
    });
    if (!existing) return res.status(404).json({ error: 'محصول یافت نشد' });

    let actualCategoryId = parseInt(categoryId);
    if (actualCategoryId) {
      const categoryExists = await prisma.category.findUnique({ where: { id: actualCategoryId } });
      if (!categoryExists) {
        await prisma.category.create({
          data: { id: actualCategoryId, name: 'دسته‌بندی ' + actualCategoryId, isActive: true, sortOrder: 0 }
        });
      }
    } else {
      const firstCategory = await prisma.category.findFirst();
      actualCategoryId = firstCategory ? firstCategory.id : existing.categoryId;
    }

    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: {
        categoryId: actualCategoryId,
        name,
        shortDescription,
        longDescription,
        supplierBasePrice: parseFloat(supplierBasePrice),
        discount: parseFloat(discount) || 0,
        sku,
        brand,
        status: 'PENDING_APPROVAL', // Revert to pending on edit
      }
    });

    res.json({ message: 'محصول با موفقیت ویرایش شد', product });
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در ویرایش محصول', details: err.message });
  }
});

// Get orders containing this supplier's products
app.get('/api/supplier/orders', authenticateToken, requireSupplier, async (req: any, res) => {
  try {
    const orderItems = await prisma.orderItem.findMany({
      where: { supplierId: req.user.userId },
      include: { order: true, product: true, variant: true }
    });
    res.json(orderItems);
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت سفارشات' });
  }
});

// Update order item status
app.patch('/api/supplier/orders/:itemId', authenticateToken, requireSupplier, async (req: any, res) => {
  try {
    const { status, trackingCode } = req.body;
    const { itemId } = req.params;
    
    // Ensure item belongs to this supplier
    const item = await prisma.orderItem.findFirst({
      where: { id: parseInt(itemId), supplierId: req.user.userId }
    });

    if (!item) {
      return res.status(404).json({ error: 'سفارش یافت نشد' });
    }

    const updated = await prisma.orderItem.update({
      where: { id: item.id },
      data: { status, trackingCode }
    });
    
    res.json({ message: 'وضعیت سفارش به روز شد', updated });
  } catch (err: any) {
    res.status(500).json({ error: 'بروزرسانی سفارش با خطا مواجه شد' });
  }
});

// Get wallet balance and transactions
app.get('/api/supplier/wallet', authenticateToken, requireSupplier, async (req: any, res) => {
  try {
    const wallet = await prisma.supplierWallet.findUnique({
      where: { supplierId: req.user.userId }
    });
    const transactions = await prisma.supplierTransaction.findMany({
      where: { supplierId: req.user.userId },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ wallet, transactions });
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت اطلاعات مالی' });
  }
});

// Update supplier profile
app.put('/api/supplier/profile', authenticateToken, requireSupplier, async (req: any, res) => {
  try {
    const { firstName, lastName, brandName, shaba, mobile } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.userId },
      data: { firstName, lastName, brandName, shaba, mobile }
    });
    res.json({ message: 'پروفایل با موفقیت بروزرسانی شد', user });
  } catch (err) {
    res.status(500).json({ error: 'خطا در بروزرسانی پروفایل' });
  }
});

// Get tickets
app.get('/api/supplier/tickets', authenticateToken, requireSupplier, async (req: any, res) => {
  try {
    const tickets = await prisma.ticket.findMany({
      where: { userId: req.user.userId },
      include: { messages: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: 'خطا در دریافت تیکت‌ها' });
  }
});

// Create ticket
app.post('/api/supplier/tickets', authenticateToken, requireSupplier, async (req: any, res) => {
  try {
    const { subject, department, priority, message } = req.body;
    const ticket = await prisma.ticket.create({
      data: {
        userId: req.user.userId,
        subject,
        department,
        priority,
        messages: {
          create: [{ userId: req.user.userId, message }]
        }
      }
    });
    res.status(201).json(ticket);
  } catch (err) {
    res.status(500).json({ error: 'خطا در ایجاد تیکت' });
  }
});

// Add message to ticket
app.post('/api/supplier/tickets/:id/messages', authenticateToken, requireSupplier, async (req: any, res) => {
  try {
    const { message } = req.body;
    const { id } = req.params;
    
    // Ensure ticket belongs to user
    const existing = await prisma.ticket.findFirst({
      where: { id: parseInt(id), userId: req.user.userId }
    });
    if (!existing) return res.status(404).json({ error: 'تیکت یافت نشد' });

    const ticketMsg = await prisma.ticketMessage.create({
      data: {
        ticketId: parseInt(id),
        userId: req.user.userId,
        message
      }
    });
    res.status(201).json(ticketMsg);
  } catch (err) {
    res.status(500).json({ error: 'خطا در ثبت پیام' });
  }
});

// --- Store Manager API Routes ---
const requireStoreManager = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'STORE_MANAGER') {
    return res.status(403).json({ error: 'دسترسی فقط برای مدیر فروشگاه مجاز است' });
  }
  next();
};

app.get('/api/store-manager/stats', authenticateToken, requireStoreManager, async (req: any, res: any) => {
  try {
    const storeId = req.user.userId;

    const totalOrders = await prisma.order.count({ where: { storeId } });
    const paidInvoices = await prisma.storeInvoice.findMany({ where: { storeManagerId: storeId, status: 'PAID' } });
    const totalPaid = paidInvoices.reduce((acc, inv) => acc + inv.totalAmount, 0);

    // Get recently added items (mock)
    const recentActivity = await prisma.order.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    res.json({ totalOrders, totalPaid, netProfit: totalPaid * 1.5, recentActivity });
  } catch (err) {
    res.status(500).json({ error: 'خطا در دریافت آمار' });
  }
});

app.get('/api/store-manager/marketplace-products', authenticateToken, requireStoreManager, async (req: any, res: any) => {
  try {
    const products = await prisma.product.findMany({
      where: { status: 'ACTIVE' },
      include: {
        category: true,
        supplier: { select: { brandName: true, firstName: true, lastName: true } }
      }
    });

    // Calculate final price dynamically
    const productsWithFinalPrice = products.map(product => {
      let finalPrice = product.supplierBasePrice;
      if (product.marginType === 'PERCENTAGE' && product.marginValue) {
        finalPrice = product.supplierBasePrice * (1 + product.marginValue / 100);
      } else if (product.marginType === 'FIXED' && product.marginValue) {
        finalPrice = product.supplierBasePrice + product.marginValue;
      }
      return { ...product, finalPrice };
    });

    res.json(productsWithFinalPrice);
  } catch (err) {
    res.status(500).json({ error: 'خطا در دریافت محصولات' });
  }
});

app.get('/api/store-manager/orders', authenticateToken, requireStoreManager, async (req: any, res: any) => {
  try {
    const storeId = req.user.userId;
    const { status } = req.query; // unpaid or paid

    let whereClause: any = { storeId };
    if (status === 'unpaid') {
      whereClause.storeInvoiceId = null;
    } else if (status === 'paid') {
      whereClause.storeInvoiceId = { not: null };
    }

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        items: { include: { product: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'خطا در دریافت سفارشات' });
  }
});

app.post('/api/store-manager/settle-orders', authenticateToken, requireStoreManager, async (req: any, res: any) => {
  try {
    const storeId = req.user.userId;
    const { orderIds } = req.body;
    
    if (!orderIds || orderIds.length === 0) {
      return res.status(400).json({ error: 'سفارشی انتخاب نشده است' });
    }

    // Verify all orders belong to this store and are unpaid
    const ordersToPay = await prisma.order.findMany({
      where: {
        id: { in: orderIds },
        storeId,
        storeInvoiceId: null
      }
    });

    if (ordersToPay.length !== orderIds.length) {
      return res.status(400).json({ error: 'برخی از سفارشات نامعتبر یا قبلا پرداخت شده اند' });
    }

    const totalAmount = ordersToPay.reduce((acc, o) => acc + o.totalAmount, 0);

    await prisma.$transaction(async (tx) => {
      const invoice = await tx.storeInvoice.create({
        data: {
          storeManagerId: storeId,
          totalAmount,
          status: 'PAID',
          paidAt: new Date()
        }
      });

      await tx.order.updateMany({
        where: { id: { in: orderIds } },
        data: { storeInvoiceId: invoice.id, status: 'PAID' }
      });
    });

    res.json({ message: 'پرداخت با موفقیت انجام شد' });
  } catch (err) {
    res.status(500).json({ error: 'خطا در تسویه سفارشات' });
  }
});

app.get('/api/store-manager/invoices', authenticateToken, requireStoreManager, async (req: any, res: any) => {
  try {
    const storeId = req.user.userId;
    const invoices = await prisma.storeInvoice.findMany({
      where: { storeManagerId: storeId },
      orderBy: { createdAt: 'desc' }
    });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: 'خطا در دریافت فاکتورها' });
  }
});

app.get('/api/store-manager/settings', authenticateToken, requireStoreManager, async (req: any, res: any) => {
  try {
    const storeId = req.user.userId;
    let settings = await prisma.storeSettings.findUnique({
      where: { storeManagerId: storeId }
    });
    
    if (!settings) {
      settings = await prisma.storeSettings.create({
        data: { storeManagerId: storeId }
      });
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: 'خطا در دریافت تنظیمات' });
  }
});

app.post('/api/store-manager/settings', authenticateToken, requireStoreManager, async (req: any, res: any) => {
  try {
    const storeId = req.user.userId;
    const { platformType, apiKey, webhookUrl } = req.body;
    
    const settings = await prisma.storeSettings.upsert({
      where: { storeManagerId: storeId },
      update: { platformType, apiKey, webhookUrl },
      create: { storeManagerId: storeId, platformType, apiKey, webhookUrl }
    });
    
    res.json({ message: 'تنظیمات با موفقیت ذخیره شد', settings });
  } catch (err) {
    res.status(500).json({ error: 'خطا در ذخیره تنظیمات' });
  }
});


// --- Admin API Routes ---
const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'دسترسی فقط برای مدیر کل مجاز است' });
  }
  next();
};

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req: any, res: any) => {
  try {
    const suppliersCount = await prisma.user.count({ where: { role: 'SUPPLIER' } });
    const storesCount = await prisma.user.count({ where: { role: 'STORE_MANAGER' } });
    const productsCount = await prisma.product.count();
    const ordersCount = await prisma.order.count();
    const totalRevenue = await prisma.storeInvoice.aggregate({ _sum: { totalAmount: true }, where: { status: 'PAID' } });

    res.json({
      suppliers: suppliersCount,
      stores: storesCount,
      activeProducts: productsCount,
      orders: ordersCount,
      totalRevenue: totalRevenue._sum.totalAmount || 0
    });
  } catch (err) {
    res.status(500).json({ error: 'خطا در دریافت آمار' });
  }
});

app.get('/api/admin/products', authenticateToken, requireAdmin, async (req: any, res: any) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        category: true,
        supplier: { select: { firstName: true, lastName: true, brandName: true } }
      }
    });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'خطا در دریافت محصولات' });
  }
});

app.patch('/api/admin/products/:id/margin', authenticateToken, requireAdmin, async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { marginType, marginValue } = req.body;
    const product = await prisma.product.update({
      where: { id: parseInt(id) },
      data: { marginType, marginValue: parseFloat(marginValue), status: 'ACTIVE' }
    });
    res.json({ message: 'حاشیه سود و وضعیت محصول بروز شد', product });
  } catch (err) {
    res.status(500).json({ error: 'خطا در بروزرسانی محصول' });
  }
});

app.get('/api/admin/suppliers', authenticateToken, requireAdmin, async (req: any, res: any) => {
  try {
    const suppliers = await prisma.user.findMany({
      where: { role: 'SUPPLIER' },
      select: { id: true, firstName: true, lastName: true, brandName: true, status: true, mobile: true, createdAt: true }
    });
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: 'خطا' });
  }
});

app.get('/api/admin/stores', authenticateToken, requireAdmin, async (req: any, res: any) => {
  try {
    const stores = await prisma.user.findMany({
      where: { role: 'STORE_MANAGER' },
      select: { id: true, firstName: true, lastName: true, storeName: true, status: true, mobile: true, createdAt: true }
    });
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: 'خطا' });
  }
});

app.get('/api/admin/orders', authenticateToken, requireAdmin, async (req: any, res: any) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        store: { select: { storeName: true } },
        items: { include: { product: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'خطا در دریافت سفارشات' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start Express Server
  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Backend Express server running on port ${PORT}`);
    await seedSuperAdmin();
  });
}

startServer();
