import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/set-admin-password.js <new-password>");
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 10));
console.log("\nPaste the line above into server/.env as ADMIN_PASSWORD_HASH, then restart the server.");
