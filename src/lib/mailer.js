import nodemailer from "nodemailer";

const {
  SMTP_HOST,
  SMTP_PORT = "587",
  SMTP_SECURE = "false",
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
  MAIL_TO,
} = process.env;

const transporter = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE === "true",
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;

// Email notification is best-effort — a lead is already persisted to disk before this runs,
// so a misconfigured or absent SMTP setup must never fail the request.
export async function notifyLead(subject, lines) {
  if (!transporter || !MAIL_TO) return { sent: false, reason: "smtp not configured" };

  try {
    await transporter.sendMail({
      from: MAIL_FROM || "no-reply@kseliteattorneys.com",
      to: MAIL_TO,
      subject,
      text: lines.join("\n"),
    });
    return { sent: true };
  } catch (err) {
    console.error("Failed to send lead notification email:", err.message);
    return { sent: false, reason: err.message };
  }
}
