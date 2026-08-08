/**
 * Outbound email.
 *
 * Provider precedence:
 *   1. Resend (HTTP API — no SMTP hassle, best deliverability). Set RESEND_API_KEY.
 *   2. SMTP via nodemailer. Set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS.
 *   3. Dev logger — nothing is configured, so we just log the message (including
 *      any action link) to the console. This keeps the whole invite flow testable
 *      locally before credentials exist; it never throws.
 *
 * `MAIL_FROM` is the sender (e.g. `FeedBoard <invites@yourdomain.com>`); a
 * transactional provider requires a verified sender/domain. `MAIL_REPLY_TO`
 * (e.g. tahmidshahriar.bd@gmail.com) is where replies land.
 */
const MAIL_FROM = process.env.MAIL_FROM || "FeedBoard <onboarding@resend.dev>";
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || "tahmidshahriar.bd@gmail.com";

/**
 * Sender identity for mail that reads as a personal note from the team (e.g. an
 * admin changing an account's plan) rather than an automated product email.
 *
 * Deliberately reuses `MAIL_FROM`'s exact address, only swapping the display
 * name to "FeedBoard Support" — the address is the thing a provider actually
 * has verified (SPF/DKIM/domain), so sending from a different address here
 * would silently fail or land in spam. `MAIL_FROM_SUPPORT` is available to
 * override independently (e.g. a real `support@` inbox) once one exists.
 */
const MAIL_FROM_SUPPORT =
  process.env.MAIL_FROM_SUPPORT ||
  MAIL_FROM.replace(/^[^<]*(?=<)/, "FeedBoard Support ").trim();

const isResendConfigured = () => Boolean(process.env.RESEND_API_KEY);
const isSmtpConfigured = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

/** True when a real provider is wired up (otherwise we only log). */
const isMailConfigured = () => isResendConfigured() || isSmtpConfigured();

async function sendViaResend({ to, subject, html, text, from }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: from || MAIL_FROM,
      to: [to],
      reply_to: MAIL_REPLY_TO,
      subject,
      html,
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body}`);
  }
  return res.json();
}

async function sendViaSmtp({ to, subject, html, text, from }) {
  // Required lazily so the app boots without nodemailer being configured.
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter.sendMail({
    from: from || MAIL_FROM,
    to,
    replyTo: MAIL_REPLY_TO,
    subject,
    html,
    text,
  });
}

/**
 * Send an email. Resolves `{ sent, provider }`. Never throws — a mail failure
 * must not break the operation that triggered it (the caller decides what to
 * tell the user).
 */
const logEmail = (banner, { to, subject, text }) => {
  console.log(
    [
      "",
      `──────────── EMAIL (${banner}) ────────────`,
      `To:      ${to}`,
      `Subject: ${subject}`,
      "",
      (text || "").trim(),
      "──────────────────────────────────────────────────────────────",
      "",
    ].join("\n")
  );
};

/**
 * @param {object} p
 * @param {string} [p.from] Sender override, e.g. `MAIL_FROM_SUPPORT` for mail
 *   that should read as a note from the team rather than the product default.
 *   Must be an address the configured provider actually has verified — see the
 *   comment on `MAIL_FROM_SUPPORT` above.
 */
const sendEmail = async ({ to, subject, html, text, from }) => {
  try {
    if (isResendConfigured()) {
      await sendViaResend({ to, subject, html, text, from });
      return { sent: true, provider: "resend" };
    }
    if (isSmtpConfigured()) {
      await sendViaSmtp({ to, subject, html, text, from });
      return { sent: true, provider: "smtp" };
    }
    logEmail("not sent — no mail provider configured", { to, subject, text });
    return { sent: false, provider: "log" };
  } catch (error) {
    // A provider is configured but the send failed (bad credentials, rate limit,
    // …). Still log the message so the action link is never lost.
    console.error("sendEmail failed:", error.message);
    logEmail(`NOT SENT — provider error: ${error.message}`, { to, subject, text });
    return { sent: false, provider: "error", error: error.message };
  }
};

module.exports = { sendEmail, isMailConfigured, MAIL_FROM_SUPPORT };
