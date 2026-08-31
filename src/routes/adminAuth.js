import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const router = Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  const secret = process.env.ADMIN_JWT_SECRET;
  const expectedUser = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!secret || !expectedUser || !passwordHash) {
    return res.status(503).json({ error: "Admin auth is not configured on this server." });
  }

  const validUser = username === expectedUser;
  const validPass = validUser && (await bcrypt.compare(password ?? "", passwordHash));
  if (!validUser || !validPass) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  const token = jwt.sign({ sub: username, role: "admin" }, secret, { expiresIn: "12h" });
  res.json({ token });
});

export default router;
