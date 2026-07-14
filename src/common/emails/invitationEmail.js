/**
 * Branded workspace-invitation email. Table-based layout with inline styles —
 * the only thing email clients reliably render.
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

/**
 * @param {object} p
 * @param {string} p.workspaceName  workspace they're invited to
 * @param {string} p.inviterName    who invited them
 * @param {string} p.acceptUrl      one-time invite link
 * @param {number} p.expiresInDays  link validity
 */
const invitationEmail = ({ workspaceName, inviterName, acceptUrl, expiresInDays }) => {
  const ws = esc(workspaceName);
  const who = esc(inviterName || "A teammate");
  const url = esc(acceptUrl);

  const subject = `${who} invited you to join ${workspaceName} on Feedbase`;

  const text = [
    `${who} invited you to join the "${workspaceName}" workspace on Feedbase.`,
    "",
    "Feedbase is where the team collects product feedback, prioritises it by votes,",
    "and shares a public roadmap and changelog.",
    "",
    "Accept your invitation:",
    acceptUrl,
    "",
    `This link is valid for ${expiresInDays} days and can only be used once.`,
    "If you weren't expecting this invitation, you can safely ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${WASH};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${WASH};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid rgba(227,153,163,0.35);border-radius:16px;overflow:hidden;">
            <!-- header -->
            <tr>
              <td style="background:linear-gradient(135deg,${INK} 0%,#7a2d38 55%,${BRAND} 100%);padding:28px 32px;">
                <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.2px;">Feedbase</span>
              </td>
            </tr>

            <!-- body -->
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${INK};font-weight:700;">
                  You've been invited to <span style="color:${BRAND};">${ws}</span>
                </h1>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:rgba(28,10,12,0.72);">
                  <strong style="color:${INK};">${who}</strong> invited you to join the
                  <strong style="color:${INK};">${ws}</strong> workspace on Feedbase — where the team
                  collects product feedback, prioritises it by votes, and shares a public roadmap.
                </p>

                <!-- CTA -->
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
                  <tr>
                    <td style="border-radius:10px;background:${BRAND};">
                      <a href="${url}"
                         style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
                        Accept invitation
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 6px;font-size:12px;color:rgba(28,10,12,0.5);">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 22px;font-size:12px;word-break:break-all;">
                  <a href="${url}" style="color:${BRAND};text-decoration:underline;">${url}</a>
                </p>

                <div style="padding:12px 14px;border-radius:10px;background:${WASH};border:1px solid rgba(227,153,163,0.3);">
                  <p style="margin:0;font-size:12px;line-height:1.5;color:rgba(28,10,12,0.6);">
                    🔒 This invitation is valid for <strong style="color:${INK};">${expiresInDays} days</strong>
                    and can only be used <strong style="color:${INK};">once</strong>.
                  </p>
                </div>
              </td>
            </tr>

            <!-- footer -->
            <tr>
              <td style="padding:18px 32px 26px;border-top:1px solid rgba(227,153,163,0.25);">
                <p style="margin:0;font-size:12px;line-height:1.5;color:rgba(28,10,12,0.45);">
                  If you weren't expecting this invitation, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:16px 0 0;font-size:11px;color:rgba(28,10,12,0.35);">Powered by Feedbase</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
};

module.exports = { invitationEmail };
