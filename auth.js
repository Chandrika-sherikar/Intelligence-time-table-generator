const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Demo secret — in production this MUST come from an environment variable,
// never be committed, and be rotated. Kept as a literal here only so the
// demo runs with zero configuration.
const JWT_SECRET = process.env.JWT_SECRET || 'period-zero-demo-secret-change-me';
const TOKEN_TTL = '8h';

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, facultyId: user.facultyId || null, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

/** Express middleware: requires a valid bearer token. Optionally restrict to a set of roles. */
function requireAuth(allowedRoles = null) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token.' });

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
        facultyId: payload.facultyId,
        name: payload.name
      };
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    if (allowedRoles && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `This action requires one of: ${allowedRoles.join(', ')}. You are signed in as ${req.user.role}.` });
    }
    next();
  };
}

module.exports = { hashPassword, verifyPassword, issueToken, requireAuth, JWT_SECRET };
