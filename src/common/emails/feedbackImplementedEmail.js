/**
 * "Your feedback is implemented" email, sent to the submitter when the owner
 * marks their feedback completed and chooses to notify them (Pro+ feature).
 * Table-based + inline styles — the only thing email clients render reliably.
 */
const BRAND = "#c74959";
const INK = "#1c0a0c";
const WASH = "#fdf8f9";

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const truncate = (s, n) => {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/**
 * @param {object} p
 * @param {string} p.workspaceName
 * @param {string} p.title         the feedback title
 * @param {string} p.submitterName the person's name, or "there"
 * @param {string} [p.postUrl]     public link to the post (optional)
 */
const feedbackImplementedEmail = ({
  workspaceName,
  title,
  submitterName,
  postUrl,
}) => {
  const ws = esc(workspaceName);
  const t = esc(title);
  const who = esc((submitterName || "").trim() || "there");
  const url = postUrl ? esc(postUrl) : "";

  const subject = `Your feedback was implemented: ${truncate(title, 60)}`;

  const text = [
    `Hi ${(submitterName || "").trim() || "there"},`,
    "",
    `Good news — the feedback you shared with ${workspaceName} has been implemented:`,
    `"${title}"`,
    "",
    "Thank you for helping shape the product.",
    ...(postUrl ? ["", "See it here:", postUrl] : []),
    "",
    `— The ${workspaceName} team`,
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${WASH};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${WASH};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid rgba(227,153,163,0.35);border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,${INK} 0%,#7a2d38 55%,${BRAND} 100%);padding:24px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;">${ws}</span>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 32px;">
                <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:${BRAND};font-weight:700;">
                  ✅ Implemented
                </p>
                <p style="margin:12px 0 0;font-size:16px;line-height:1.6;color:${INK};">
                  Hi ${who}, good news — the feedback you shared has been
                  <strong>implemented</strong>:
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0;width:100%;">
                  <tr>
                    <td style="padding:14px 16px;border-radius:12px;background:${WASH};border:1px solid rgba(227,153,163,0.3);">
                      <p style="margin:0;font-size:17px;font-weight:700;line-height:1.35;color:${INK};">
                        ${t}
                      </p>
                    </td>
                  </tr>
                </table>

                <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:rgba(28,10,12,0.7);">
                  Thank you for helping shape the product.
                </p>

                ${
                  url
                    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;">
                    <tr>
                      <td style="border-radius:10px;background:${BRAND};">
                        <a href="${url}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                          See it on the board
                        </a>
                      </td>
                    </tr>
                  </table>`
                    : ""
                }
              </td>
            </tr>

            <tr>
              <td style="padding:16px 32px 24px;border-top:1px solid rgba(227,153,163,0.25);">
                <p style="margin:0;font-size:12px;line-height:1.5;color:rgba(28,10,12,0.45);">
                  You're receiving this because you submitted feedback to <strong>${ws}</strong>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
};

module.exports = { feedbackImplementedEmail };
