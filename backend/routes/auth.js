const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

// @route   POST api/auth/register
// @desc    Register user
// @access  Public
router.post('/register', async (req, res) => {
    const { username, password, role } = req.body;

    try {
        let user = await User.findOne({ username });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        user = new User({
            username,
            password,
            role: role || 'user'
        });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);

        await user.save();

        const payload = {
            user: {
                id: user.id,
                role: user.role
            }
        };

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '24h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// Simple In-Memory Rate Limiter for Login Endpoint
const loginAttempts = {};
const rateLimitLogin = (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    
    if (!loginAttempts[ip]) {
        loginAttempts[ip] = [];
    }
    
    // Filter attempts in the last 1 minute (60000 ms)
    loginAttempts[ip] = loginAttempts[ip].filter(timestamp => now - timestamp < 60000);
    
    if (loginAttempts[ip].length >= 10) {
        return res.status(429).json({ message: 'Too many login attempts. Please try again after a minute.' });
    }
    
    loginAttempts[ip].push(now);
    next();
};

// @route   POST api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', rateLimitLogin, async (req, res) => {
    const { username, password } = req.body;

    try {
        let user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Location configuration and verification
        const Warehouse = require('../models/Warehouse');
        let needsSave = false;

        if (user.role === 'admin') {
            if (!user.currentWarehouse) {
                const mainWh = await Warehouse.findOne({ code: 'WH-MAIN' });
                if (mainWh) {
                    user.currentWarehouse = mainWh._id;
                    needsSave = true;
                } else {
                    const anyWh = await Warehouse.findOne();
                    if (anyWh) {
                        user.currentWarehouse = anyWh._id;
                        needsSave = true;
                    }
                }
            }
        } else {
            // Standard users (manager/user) must have allowed location list
            if (!user.allowedWarehouses || user.allowedWarehouses.length === 0) {
                return res.status(400).json({ message: 'Login denied. Identity lacks assigned location access permissions.' });
            }
            if (!user.currentWarehouse || !user.allowedWarehouses.some(id => String(id) === String(user.currentWarehouse))) {
                user.currentWarehouse = user.allowedWarehouses[0];
                needsSave = true;
            }
        }

        if (needsSave) {
            await user.save();
        }

        const payload = {
            user: {
                id: user.id,
                role: user.role,
                currentWarehouse: user.currentWarehouse
            }
        };

        let populatedUser = await User.findById(user.id)
            .select('-password')
            .populate('currentWarehouse')
            .populate('allowedWarehouses');

        if (populatedUser.role === 'admin') {
            const allWarehouses = await Warehouse.find({ status: 'active' });
            populatedUser = populatedUser.toObject();
            populatedUser.allowedWarehouses = allWarehouses;
        }

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '24h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token, user: populatedUser });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
});

// @route   GET api/auth/user
// @desc    Get current user
// @access  Private
router.get('/user', auth, async (req, res) => {
    try {
        let userObj = await User.findById(req.user.id)
            .select('-password')
            .populate('currentWarehouse')
            .populate('allowedWarehouses');
        
        if (!userObj) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (userObj.role === 'admin') {
            const Warehouse = require('../models/Warehouse');
            const allWarehouses = await Warehouse.find({ status: 'active' });
            userObj = userObj.toObject();
            userObj.allowedWarehouses = allWarehouses;
        }

        res.json(userObj);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST api/auth/switch-location
// @desc    Switch active session warehouse location
// @access  Private
router.post('/switch-location', auth, async (req, res) => {
    const { warehouseId } = req.body;
    if (!warehouseId) {
        return res.status(400).json({ message: 'Warehouse ID is required' });
    }

    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Validate location switcher permissions
        if (user.role !== 'admin') {
            const hasAccess = user.allowedWarehouses.some(id => String(id) === String(warehouseId));
            if (!hasAccess) {
                return res.status(403).json({ message: 'Access denied. You do not have permissions for this location.' });
            }
        } else {
            const Warehouse = require('../models/Warehouse');
            const warehouseExists = await Warehouse.findById(warehouseId);
            if (!warehouseExists) {
                return res.status(404).json({ message: 'Selected warehouse not found.' });
            }
        }

        user.currentWarehouse = warehouseId;
        await user.save();

        const payload = {
            user: {
                id: user.id,
                role: user.role,
                currentWarehouse: user.currentWarehouse
            }
        };

        let populatedUser = await User.findById(user.id)
            .select('-password')
            .populate('currentWarehouse')
            .populate('allowedWarehouses');

        if (populatedUser.role === 'admin') {
            const Warehouse = require('../models/Warehouse');
            const allWarehouses = await Warehouse.find({ status: 'active' });
            populatedUser = populatedUser.toObject();
            populatedUser.allowedWarehouses = allWarehouses;
        }

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '24h' },
            (err, token) => {
                if (err) throw err;
                res.json({ token, user: populatedUser });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
