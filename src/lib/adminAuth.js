import jwt from "jsonwebtoken";
import { hasPermission } from "./permissions.js";

function verify(req, res) {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Admin auth is not configured on this server." });
    return null;
  }

  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  try {
    return jwt.verify(token, secret);
  } catch {
    res.status(401).json({ error: "Invalid or expired session." });
    return null;
  }
}

// Any valid admin session, regardless of section permissions — used for
// endpoints every logged-in admin should reach (e.g. /me).
export function requireAdminAuth(req, res, next) {
  const admin = verify(req, res);
  if (!admin) return;
  req.admin = admin;
  next();
}

// Valid session AND permission for this specific section (or "*" superadmin).
export function requirePermission(section) {
  return (req, res, next) => {
    const admin = verify(req, res);
    if (!admin) return;
    if (!hasPermission(admin.permissions, section)) {
      return res.status(403).json({ error: "You don't have access to this section." });
    }
    req.admin = admin;
    next();
  };
}

// Only the root env-based admin (full "*" access) — user management is never
// delegable, so a scoped admin can't create another admin with more access
// than they themselves were granted.
export function requireSuperAdmin(req, res, next) {
  const admin = verify(req, res);
  if (!admin) return;
  if (!admin.permissions?.includes("*")) {
    return res.status(403).json({ error: "Only the primary admin can manage users." });
  }
  req.admin = admin;
  next();
}
