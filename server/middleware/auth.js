const jwt = require('jsonwebtoken');
const SECRET = 'UNIFLOURISH_SECRET_2026';

function extractToken(req) {
  // 1. Cookie
  if (req.cookies && req.cookies.token) return req.cookies.token;
  // 2. Authorization header
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.split(' ')[1];
  return null;
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

// Require logged-in user (any role)
const requireUser = (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const decoded = verifyToken(token);
    req.userId = decoded.uid;
    req.username = decoded.username;
    req.userRole = decoded.role || 'user';
    next();
  } catch (e) {
    res.status(401).json({ error: '登录已过期' });
  }
};

// Require admin (super_admin or poor_admin)
const requireAdmin = (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const decoded = verifyToken(token);
    if (decoded.role !== 'super_admin' && decoded.role !== 'poor_admin') {
      return res.status(403).json({ error: '无管理员权限' });
    }
    req.userId = decoded.uid;
    req.adminRole = decoded.role;
    req.adminUsername = decoded.username;
    req.username = decoded.username;
    req.userRole = decoded.role;
    next();
  } catch (e) {
    res.status(401).json({ error: '登录已过期' });
  }
};

// Optional auth: decode JWT if present, but don't fail if missing
const optionalAuth = (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    req.userId = null; req.username = null; req.userRole = null;
    return next();
  }
  try {
    const decoded = verifyToken(token);
    req.userId = decoded.uid;
    req.username = decoded.username;
    req.userRole = decoded.role || 'user';
  } catch (e) {
    req.userId = null; req.username = null; req.userRole = null;
  }
  next();
};

module.exports = { requireUser, requireAdmin, optionalAuth, SECRET, extractToken };
