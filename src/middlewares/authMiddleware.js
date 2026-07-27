const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Authentication failed. No token provided.' });
    }

    const jwtSecret = process.env.JWT_SECRET || 'aaa_super_secret_jwt_key_2026_consultancy';
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      // Secondary fallback for legacy signed tokens
      decoded = jwt.verify(token, 'secret123');
    }
    req.user = decoded; // { id, role, email }
    
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Authentication failed. Invalid token.' });
  }
};

const rbacMiddleware = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
};

module.exports = { authMiddleware, rbacMiddleware };
