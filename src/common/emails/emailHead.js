/**
 * Shared <head> for every FeedBoard email: the dark-mode declaration and the
 * overrides that go with it. ONE copy — the five templates already duplicate
 * their palette and wrapper, and five copies of this would drift immediately.
 *
 * The bug it fixes: with no colour-scheme declaration, the Gmail app applies
 * blunt FULL inversion to the message. Our brand header and button keep their
 * dark rose background (Gmail leaves dark backgrounds alone) while the white
 * text on top of them is flipped to near-black — so the "FeedBoard" wordmark
 * and the "Review this feedback" label became unreadable on their own brand
 * colour.
 *
 * Two halves, and both are needed:
 *
 *   1. Declaring `color-scheme: light dark` (meta + CSS) tells the client the
 *      message handles dark mode itself. Clients that honour it (Apple Mail,
 *      Outlook.com, and Gmail to a large degree) stop force-inverting and use
 *      the rules below instead.
 *   2. The overrides then define what dark mode should actually look like,
 *      rather than leaving it to a client's guess — dark surfaces, light body
 *      text, and the two pieces of white-on-brand text pinned white with
 *      !important so no client rewrite can turn them dark again.
 *
 * Outlook.com does not support prefers-color-scheme; it rewrites inline styles
 * and stamps the tree with `[data-ogsc]` / `[data-ogsb]`, so the same rules are
 * emitted a second time under those selectors (generated from one list, not
 * hand-copied).
 *
 * HONEST LIMIT: Gmail's inversion cannot be switched off outright, and its
 * behaviour differs across Android/iOS/web. This is the standard mitigation
 * and fixes the reported unreadable text, but exact rendering still varies by
 * client and cannot be verified from this repo — only in a real inbox.
 */

/** Class names the templates tag their elements with. */
const DARK_RULES = [
  // Page + card surfaces.
  [".fb-body, .fb-outer", "background:#140a0b !important;"],
  [".fb-card", "background:#221315 !important;border-color:rgba(227,153,163,0.22) !important;"],
  [".fb-panel", "background:rgba(253,248,249,0.05) !important;border-color:rgba(227,153,163,0.2) !important;"],
  [".fb-divider", "border-color:rgba(227,153,163,0.18) !important;"],
  // Text.
  [".fb-heading, .fb-strong", "color:#fdf8f9 !important;"],
  [".fb-text", "color:rgba(253,248,249,0.75) !important;"],
  [".fb-muted", "color:rgba(253,248,249,0.5) !important;"],
  // Brand rose is a 3.9:1 accent on the dark card — under AA. Lightened for
  // dark only; the light palette keeps the real brand colour.
  [".fb-accent", "color:#f2a3ad !important;"],
  // The two that broke: white on brand, must stay white.
  [".fb-wordmark", "color:#ffffff !important;"],
  [".fb-btn, .fb-btn a", "color:#ffffff !important;"],
];

const block = (prefix) =>
  DARK_RULES.map(([sel, decl]) =>
    `      ${sel.split(", ").map((s) => `${prefix}${s}`).join(", ")} { ${decl} }`
  ).join("\n");

const EMAIL_HEAD = `  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      @media (prefers-color-scheme: dark) {
${block("")}
      }
${block("[data-ogsc] ")}
    </style>
  </head>`;

module.exports = { EMAIL_HEAD };
