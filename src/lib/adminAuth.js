import jwt from "jsonwebtoken";

export function requireAdminAuth(req, res, next) {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) return res.status(503).json({ error: "Admin auth is not configured on this server." });

  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    req.admin = jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}
