const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['admin', 'manager', 'user'],
        default: 'user'
    },
    access: {
        dashboard: { type: Boolean, default: true },
        items: { type: Boolean, default: true },
        items_edit: { type: Boolean, default: true },
        stock: { type: Boolean, default: true },
        stock_edit: { type: Boolean, default: true },
        pos: { type: Boolean, default: true },
        price: { type: Boolean, default: true },
        crm: { type: Boolean, default: true },
        crm_edit: { type: Boolean, default: true },
        supply: { type: Boolean, default: true },
        supply_edit: { type: Boolean, default: true },
        invoices: { type: Boolean, default: true },
        invoices_edit: { type: Boolean, default: true },
        users: { type: Boolean, default: false },
        users_edit: { type: Boolean, default: false },
        reports: { type: Boolean, default: true },
        settings: { type: Boolean, default: false },
        approvals: { type: Boolean, default: false },
        recent_bills: { type: Boolean, default: false },
        direct_stock: { type: Boolean, default: true }
    },
    allowedWarehouses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    }],
    currentWarehouse: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Warehouse'
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
