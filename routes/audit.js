const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const auth = require('../middleware/auth');

// Get recent audit log trails for admin
router.get('/', auth, async (req, res) => {
    try {
        // Standard clearance check: only admin/root accesses audit trails
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Insufficient Clearance level.' });
        }

        const warehouseId = req.query.warehouseId || req.user.currentWarehouse;
        const query = {};
        if (warehouseId) {
            query.warehouseId = warehouseId;
        }

        const logs = await AuditLog.find(query).sort({ timestamp: -1 }).limit(100);
        res.json(logs);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
