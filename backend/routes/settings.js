const express = require('express');
const router = express.Router();
const SystemSetting = require('../models/SystemSetting');
const auth = require('../middleware/auth');
const Item = require('../models/Item');

const User = require('../models/User');

// Middleware to check if user is admin or has settings access
const settingsAccess = async (req, res, next) => {
    try {
        const currentUser = await User.findById(req.user.id);
        if (!currentUser) {
            return res.status(401).json({ message: 'Invalid operator session.' });
        }
        if (currentUser.role === 'admin' || (currentUser.access && (currentUser.access.settings === true || currentUser.access.settings === 'full'))) {
            return next();
        }
        return res.status(403).json({ message: 'Access denied. Requires settings write permission.' });
    } catch (err) {
        res.status(500).send('Handshake error.');
    }
};

// @route   GET api/settings/public
// @desc    Get public system settings (company name & logo)
// @access  Public
router.get('/public', async (req, res) => {
    try {
        let settings = await SystemSetting.findOne();
        if (!settings) {
            settings = new SystemSetting({});
            await settings.save();
        }
        res.json({
            companyName: settings.companyName,
            shopLogo: settings.shopLogo
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   GET api/settings
// @desc    Get current system settings
// @access  Private (all logged in users can read setting values for display)
router.get('/', auth, async (req, res) => {
    try {
        let settings = await SystemSetting.findOne();
        if (!settings) {
            // Initialize default settings if not existing
            settings = new SystemSetting({});
            await settings.save();
        }
        res.json(settings);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   PUT api/settings
// @desc    Update system settings
// @access  Private/Admin
router.put('/', [auth, settingsAccess], async (req, res) => {
    const { 
        companyName, currency, currencySymbol, taxRate, address, theme, 
        glassmorphism, animations, mobile, email, shopLogo,
        dailyStockUpdateEnabled, dailyStockUpdateQty, dailyStockUpdateTime,
        useBatchNumbers, useExpirationDates, useCostPrice
    } = req.body;

    try {
        let settings = await SystemSetting.findOne();
        if (!settings) {
            settings = new SystemSetting({});
        }

        if (companyName !== undefined) settings.companyName = companyName;
        if (currency !== undefined) settings.currency = currency;
        if (currencySymbol !== undefined) settings.currencySymbol = currencySymbol;
        if (taxRate !== undefined) settings.taxRate = parseFloat(taxRate);
        if (address !== undefined) settings.address = address;
        if (theme !== undefined) settings.theme = theme;
        if (glassmorphism !== undefined) settings.glassmorphism = glassmorphism;
        if (animations !== undefined) settings.animations = animations;
        if (mobile !== undefined) settings.mobile = mobile;
        if (email !== undefined) settings.email = email;
        if (shopLogo !== undefined) settings.shopLogo = shopLogo;
        
        if (dailyStockUpdateEnabled !== undefined) settings.dailyStockUpdateEnabled = dailyStockUpdateEnabled;
        if (dailyStockUpdateQty !== undefined) settings.dailyStockUpdateQty = parseInt(dailyStockUpdateQty) || 0;
        if (dailyStockUpdateTime !== undefined) settings.dailyStockUpdateTime = dailyStockUpdateTime;

        if (useBatchNumbers !== undefined) settings.useBatchNumbers = useBatchNumbers;
        if (useExpirationDates !== undefined) settings.useExpirationDates = useExpirationDates;
        if (useCostPrice !== undefined) settings.useCostPrice = useCostPrice;

        await settings.save();
        res.json(settings);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   POST api/settings/trigger-stock-update
// @desc    Trigger automatic daily stock update
// @access  Private
router.post('/trigger-stock-update', auth, async (req, res) => {
    try {
        const settings = await SystemSetting.findOne();
        if (!settings) {
            return res.status(404).json({ message: 'Settings not found' });
        }
        
        const targetQty = settings.dailyStockUpdateQty !== undefined ? settings.dailyStockUpdateQty : 100;
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
        res.json({ message: `Successfully updated ${items.length} items to ${targetQty} qty.` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// Helper to calculate expiration date
const calculateExpiry = (type, duration) => {
    const date = new Date();
    if (type === 'trial') {
        const days = parseInt(duration, 10);
        date.setDate(date.getDate() + days);
    } else if (type === 'subscription') {
        if (duration.includes('day')) {
            const days = parseInt(duration, 10);
            date.setDate(date.getDate() + days);
        } else if (duration.includes('month')) {
            const months = parseInt(duration, 10);
            date.setMonth(date.getMonth() + months);
        } else if (duration.includes('year')) {
            const years = parseInt(duration, 10);
            date.setFullYear(date.getFullYear() + years);
        }
    }
    return date;
};

// @route   POST api/settings/activation/activate
// @desc    Activate system trial or subscription
// @access  Private/Admin only
router.post('/activation/activate', auth, async (req, res) => {
    const { type, duration } = req.body;
    try {
        const currentUser = await User.findById(req.user.id);
        if (!currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied. Requires admin privileges.' });
        }

        let settings = await SystemSetting.findOne();
        if (!settings) {
            settings = new SystemSetting({});
        }

        const expiry = calculateExpiry(type, duration);
        settings.activationStatus = 'active';
        settings.activationType = type;
        settings.activationStartDate = new Date();
        settings.activationExpiryDate = expiry;

        await settings.save();
        res.json(settings);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   POST api/settings/activation/deactivate
// @desc    Deactivate system trial or subscription
// @access  Private/Admin only
router.post('/activation/deactivate', auth, async (req, res) => {
    try {
        const currentUser = await User.findById(req.user.id);
        if (!currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied. Requires admin privileges.' });
        }

        let settings = await SystemSetting.findOne();
        if (!settings) {
            settings = new SystemSetting({});
        }

        settings.activationStatus = 'deactivated';
        settings.activationExpiryDate = new Date(); // Expire immediately

        await settings.save();
        res.json(settings);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

module.exports = router;
