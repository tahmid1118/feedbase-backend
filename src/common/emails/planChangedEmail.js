/**
 * Sent to an account owner when a platform admin changes their plan from the
 * Admin Panel (Accounts view). Table-based + inline styles — the only thing
 * email clients render reliably. Sent from `MAIL_FROM_SUPPORT` (see mailer.js)
 * so it reads as a note from the team, not an automated billing receipt.
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
 * @param {string} p.ownerName
 * @param {string} p.oldPlanLabel   e.g. "Free"
 * @param {string} p.newPlanLabel   e.g. "Business"
 * @param {'upgraded'|'downgraded'|'changed'} p.direction
 * @param {string[]} p.workspaceNames  every workspace this account owns
 * @param {boolean} p.lifetime      true for a no-expiry comp
 * @param {string} [p.expiresAt]    human-readable date, when not lifetime
 */
const planChangedEmail = ({
  ownerName,
  oldPlanLabel,
  newPlanLabel,
  direction,
  workspaceNames,
  lifetime,
  expiresAt,
}) => {
  const who = esc((ownerName || "").trim() || "there");
  const oldP = esc(oldPlanLabel);
  const newP = esc(newPlanLabel);
  const verb =
    direction === "upgraded"
      ? "upgraded"
      : direction === "downgraded"
        ? "downgraded"
        : "changed";
  const names = (workspaceNames || []).filter(Boolean);
  const workspaceLine =
    names.length === 1
      ? `your workspace "${names[0]}"`
      : names.length > 1
        ? `your workspaces (${names.join(", ")})`
        : "your account";

  const durationNote = newPlanLabel.toLowerCase() === "free"
    ? ""
    : lifetime
      ? "This plan does not expire."
      : expiresAt
        ? `This plan is active until ${expiresAt}.`
        : "";

  const subject = `Your FeedBoard plan was ${verb} to ${newP}`;

  const text = [
    `Hi ${who},`,
    "",
    `A member of the FeedBoard team has ${verb} the plan on ${workspaceLine} from ${oldP} to ${newP}.`,
    durationNote,
    "",
    "If this is unexpected or you have any questions, just reply to this email — it goes straight to our support team.",
    "",
    "— The FeedBoard Support Team",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${WASH};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${WASH};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid rgba(227,153,163,0.35);border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg,${INK} 0%,#7a2d38 55%,${BRAND} 100%);padding:24px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;">FeedBoard Support</span>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 32px;">
                <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:${BRAND};font-weight:700;">
                  Plan ${esc(verb)}
                </p>
                <p style="margin:12px 0 0;font-size:16px;line-height:1.6;color:${INK};">
                  Hi ${who}, a member of the FeedBoard team has ${esc(verb)} the plan on
                  ${esc(workspaceLine)}:
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0;width:100%;">
                  <tr>
                    <td style="padding:14px 16px;border-radius:12px;background:${WASH};border:1px solid rgba(227,153,163,0.3);">
                      <p style="margin:0;font-size:17px;font-weight:700;line-height:1.35;color:${INK};">
                        ${oldP} <span style="color:rgba(28,10,12,0.4);font-weight:400;">→</span> ${newP}
                      </p>
                      ${
                        durationNote
                          ? `<p style="margin:6px 0 0;font-size:13px;color:rgba(28,10,12,0.6);">${esc(durationNote)}</p>`
                          : ""
                      }
                    </td>
                  </tr>
                </table>

                <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:rgba(28,10,12,0.7);">
                  If this is unexpected or you have any questions, just reply to
                  this email — it goes straight to our support team.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 32px 24px;border-top:1px solid rgba(227,153,163,0.25);">
                <p style="margin:0;font-size:12px;line-height:1.5;color:rgba(28,10,12,0.45);">
                  You're receiving this because you own an account on FeedBoard.
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

module.exports = { planChangedEmail };
