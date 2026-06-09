require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const salesRoutes = require('./routes/sales');
const userRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const customerRoutes = require('./routes/customers');
const supplyChainRoutes = require('./routes/supplychain');
const invoiceRoutes = require('./routes/invoices');
const shiftRoutes = require('./routes/shifts');
const warehouseRoutes = require('./routes/warehouses');

const app = express();

// Express HTTP Security Hardening Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

// CORS origin configuration: restrict to frontend origin
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(cors({
    origin: allowedOrigin,
    credentials: true
}));
app.use(express.json());

const bcrypt = require('bcryptjs');
const User = require('./models/User');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    console.log('Connected to MongoDB');

    // Verify and ensure database indexes for performance speedup
    try {
        const db = mongoose.connection.db;
        const safeIndex = async (collection, spec, options) => {
            try {
                await db.collection(collection).createIndex(spec, options);
            } catch (err) {
                // Ignore index conflicts if index already exists (conflict code 85 or 86)
                if (err.code !== 85 && err.code !== 86 && !err.message.includes('already exists')) {
                    console.error(`[Performance Warning] Index creation failed on ${collection}:`, err.message);
                }
            }
        };
        
        // Item collection indices
        await safeIndex('items', { barcode: 1 });
        await safeIndex('items', { name: 1 });
        await safeIndex('items', { status: 1 });
        await safeIndex('items', { category: 1 });
        await safeIndex('items', { createdAt: -1 });

        // Sales collection indices
        await safeIndex('sales', { createdAt: -1 });
        await safeIndex('sales', { soldBy: 1 });

        // Customers collection indices
        await safeIndex('customers', { phone: 1 });
        await safeIndex('customers', { createdAt: -1 });

        // AuditLogs collection indices
        await safeIndex('auditlogs', { timestamp: -1 });
        await safeIndex('auditlogs', { userId: 1 });

        // Invoices collection indices
        await safeIndex('invoices', { invoiceNumber: 1 });
        await safeIndex('invoices', { createdAt: -1 });

        // Purchase Orders collection indices
        await safeIndex('purchaseorders', { poNumber: 1 });
        await safeIndex('purchaseorders', { createdAt: -1 });

        // Goods Received Notes collection indices
        await safeIndex('grns', { grnNumber: 1 });
        await safeIndex('grns', { createdAt: -1 });

        console.log('[Performance] Database indexes verified and ensured.');
    } catch (indexErr) {
        console.error('[Performance Warning] Index verification failed:', indexErr.message);
    }
    // Seed default warehouse if none exists
    const Warehouse = require('./models/Warehouse');
    const warehouseCount = await Warehouse.countDocuments();
    if (warehouseCount === 0) {
        await Warehouse.create({
            name: 'Main Warehouse',
            code: 'WH-MAIN',
            address: 'Default HQ Location',
            status: 'active'
        });
        console.log('Initial default warehouse created: Main Warehouse (WH-MAIN)');
    }
    // Seed initial user
    const userCount = await User.countDocuments();
    if (userCount === 0) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('admin123', salt);
        await User.create({
            username: 'admin',
            password: hashedPassword,
            role: 'admin',
            access: {
                dashboard: true,
                items: true,
                items_edit: true,
                stock: true,
                stock_edit: true,
                pos: true,
                price: true,
                crm: true,
                crm_edit: true,
                supply: true,
                supply_edit: true,
                invoices: true,
                invoices_edit: true,
                users: true,
                users_edit: true,
                reports: true,
                settings: true,
                approvals: true,
                recent_bills: true
            }
        });
        console.log('Initial admin user created: admin / admin123');
    } else {
        // Run database migration helper to convert any string access keys to boolean equivalents
        const allUsers = await User.find();
        const splitKeys = ['items', 'stock', 'crm', 'supply', 'invoices', 'users'];
        const otherKeys = ['dashboard', 'pos', 'price', 'reports', 'settings', 'approvals', 'recent_bills', 'direct_stock'];

        for (let u of allUsers) {
            let changed = false;
            if (!u.access) {
                u.access = {};
            }

            // 1. Migrate split keys
            for (const key of splitKeys) {
                const val = u.access[key];
                if (typeof val === 'string') {
                    const isView = val === 'full' || val === 'view';
                    const isEdit = val === 'full';
                    u.access[key] = isView;
                    u.access[`${key}_edit`] = isEdit;
                    changed = true;
                } else if (val === undefined || val === null) {
                    if (u.role === 'admin') {
                        u.access[key] = true;
                        u.access[`${key}_edit`] = true;
                    } else {
                        const isRestricted = ['users'].includes(key);
                        u.access[key] = !isRestricted;
                        u.access[`${key}_edit`] = !isRestricted;
                    }
                    changed = true;
                }
            }

            // 2. Migrate other keys
            for (const key of otherKeys) {
                const val = u.access[key];
                if (typeof val === 'string') {
                    u.access[key] = val === 'full' || val === 'view';
                    changed = true;
                } else if (val === undefined || val === null) {
                    if (u.role === 'admin') {
                        u.access[key] = true;
                    } else {
                        const isRestricted = ['settings', 'approvals', 'recent_bills'].includes(key);
                        u.access[key] = !isRestricted;
                    }
                    changed = true;
                }
            }

            if (changed) {
                u.markModified('access');
                await u.save();
                console.log(`Migrated legacy permissions for user: ${u.username}`);
            }
        }
    }
}).catch(err => {
    console.error('Error connecting to MongoDB:', err.message);
});

const auditRoutes = require('./routes/audit');

app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/supply', supplyChainRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/warehouses', warehouseRoutes);

app.get('/api/ping', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
            return res.status(503).json({ status: 'db_disconnected' });
        }
        await mongoose.connection.db.admin().ping();
        res.json({ status: 'online' });
    } catch (err) {
        res.status(503).json({ status: 'db_disconnected', message: err.message });
    }
});

const SystemSetting = require('./models/SystemSetting');
const Item = require('./models/Item');

let lastRunDateString = '';

const runDailyStockUpdate = async () => {
    try {
        const settings = await SystemSetting.findOne();
        if (!settings || !settings.dailyStockUpdateEnabled) {
            return;
        }

        const targetQty = settings.dailyStockUpdateQty !== undefined ? settings.dailyStockUpdateQty : 100;
        console.log(`[Scheduler] Automatic Daily Stock Update triggered. Setting all items stock qty to ${targetQty}...`);

        const items = await Item.find();
        if (items.length > 0) {
            const bulkOps = items.map(item => {
                const updateDoc = {
                    quantity: targetQty
                };
                if (item.batches && item.batches.length > 0) {
                    const updatedBatches = [...item.batches];
                    updatedBatches[0].quantity = targetQty;
                    for (let i = 1; i < updatedBatches.length; i++) {
                        updatedBatches[i].quantity = 0;
                    }
                    updateDoc.batches = updatedBatches;
                }
                return {
                    updateOne: {
                        filter: { _id: item._id },
                        update: { $set: updateDoc }
                    }
                };
            });
            await Item.bulkWrite(bulkOps);
        }
        console.log(`[Scheduler] Successfully updated ${items.length} items to ${targetQty} qty.`);
    } catch (err) {
        console.error('[Scheduler Error] Daily stock update failed:', err);
    }
};

setInterval(async () => {
    try {
        const settings = await SystemSetting.findOne();
        if (!settings || !settings.dailyStockUpdateEnabled) {
            return;
        }

        const now = new Date();
        const currentHour = String(now.getHours()).padStart(2, '0');
        const currentMin = String(now.getMinutes()).padStart(2, '0');
        const currentTimeStr = `${currentHour}:${currentMin}`;

        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const date = String(now.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${date}`;

        if (currentTimeStr === settings.dailyStockUpdateTime && lastRunDateString !== todayStr) {
            lastRunDateString = todayStr;
            await runDailyStockUpdate();
        }
    } catch (err) {
        console.error('[Scheduler Interval Error]', err);
    }
}, 60 * 1000);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
const express = require('express');
const cors = require('cors'); // 1. Import CORS
const app = express();

// 2. Configure CORS to allow ONLY your Vercel frontend
const corsOptions = {
    origin: 'https://inv-frontend-gray.vercel.app', // No slash at the end!
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true 
};

// 3. Apply the CORS middleware
app.use(cors(corsOptions));
app.use(express.json()); // Your existing JSON parser

// ... the rest of your routes go here