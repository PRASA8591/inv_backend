const User = require('../models/User');

const checkPermission = (moduleKey, requiredLevel = 'view') => {
    return async (req, res, next) => {
        try {
            const user = await User.findById(req.user.id);
            if (!user) {
                return res.status(401).json({ message: 'User session invalid.' });
            }
            if (user.role === 'admin') {
                return next();
            }
            const access = user.access || {};
            let hasAccess = false;
            
            if (requiredLevel === 'full') {
                const editKey = `${moduleKey}_edit`;
                if (access[editKey] !== undefined) {
                    hasAccess = access[editKey] === true;
                } else {
                    hasAccess = access[moduleKey] === true;
                }
            } else {
                hasAccess = access[moduleKey] === true;
            }

            if (hasAccess) {
                return next();
            }
            return res.status(403).json({ message: `Access denied. Requires permission on module '${moduleKey}'.` });
        } catch (err) {
            console.error('Permission check error:', err);
            res.status(500).json({ message: 'Internal server authorization error' });
        }
    };
};

module.exports = checkPermission;
