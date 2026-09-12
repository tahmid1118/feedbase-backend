/**
 * Branded password-reset email. Table-based layout with inline styles — the
 * only thing email clients reliably render. Structure mirrors invitationEmail.js.
 */
const { EMAIL_HEAD } = require("./emailHead");

const BRAND = "#c74959";
const INK = "#1c0a0c";
const WASH = "#fdf8f9";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * @param {object} p
 * @param {string} p.resetUrl          one-time reset link
 * @param {number} p.expiresInMinutes  link validity, in minutes
 */
const passwordResetEmail = ({ resetUrl, expiresInMinutes }) => {
  const url = esc(resetUrl);
  const mins = Number(expiresInMinutes) || 60;

  const subject = "Reset your FeedBoard password";

  const text = [
    "We received a request to reset the password for your FeedBoard account.",
    "",
    "Reset your password:",
    resetUrl,
    "",
    `This link is valid for ${mins} minutes and can only be used once.`,
    "If you didn't request this, you can safely ignore this email — your",
    "password won't change until you open the link and set a new one.",
  ].join("\n");

  const html = `<!doctype html>
<html>
${EMAIL_HEAD}
  <body class="fb-body" style="margin:0;padding:0;background:${WASH};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fb-outer" style="background:${WASH};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="fb-card" style="max-width:520px;background:#ffffff;border:1px solid rgba(227,153,163,0.35);border-radius:16px;overflow:hidden;">
            <!-- header -->
            <tr>
              <td style="background:linear-gradient(135deg,${INK} 0%,#7a2d38 55%,${BRAND} 100%);padding:28px 32px;">
                <span class="fb-wordmark" style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.2px;">FeedBoard</span>
              </td>
            </tr>

            <!-- body -->
            <tr>
              <td style="padding:32px;">
                <h1 class="fb-heading" style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${INK};font-weight:700;">
                  Reset your <span class="fb-accent" style="color:${BRAND};">password</span>
                </h1>
                <p class="fb-text" style="margin:0 0 20px;font-size:15px;line-height:1.6;color:rgba(28,10,12,0.72);">
                  We received a request to reset the password for your FeedBoard account.
                  Click the button below to choose a new one.
                </p>

                <!-- CTA -->
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="border-radius:10px;background:${BRAND};">
                      <a href="${url}"
                         class="fb-btn" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>

                <p class="fb-muted" style="margin:0 0 6px;font-size:12px;color:rgba(28,10,12,0.5);">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 22px;font-size:12px;word-break:break-all;">
                  <a href="${url}" class="fb-accent" style="color:${BRAND};text-decoration:underline;">${url}</a>
                </p>

                <div class="fb-panel" style="padding:12px 14px;border-radius:10px;background:${WASH};border:1px solid rgba(227,153,163,0.3);">
                  <p class="fb-text" style="margin:0;font-size:12px;line-height:1.5;color:rgba(28,10,12,0.6);">
                    🔒 This link is valid for <strong class="fb-heading" style="color:${INK};">${mins} minutes</strong>
                    and can only be used <strong class="fb-heading" style="color:${INK};">once</strong>.
                  </p>
                </div>
              </td>
            </tr>

            <!-- footer -->
            <tr>
              <td class="fb-divider" style="padding:18px 32px 26px;border-top:1px solid rgba(227,153,163,0.25);">
                <p class="fb-muted" style="margin:0;font-size:12px;line-height:1.5;color:rgba(28,10,12,0.45);">
                  If you didn't request this, you can safely ignore this email — your
                  password won't change until you open the link and set a new one.
                </p>
              </td>
            </tr>
          </table>

          <p class="fb-muted" style="margin:16px 0 0;font-size:11px;color:rgba(28,10,12,0.35);">Powered by FeedBoard</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
};

module.exports = { passwordResetEmail };
