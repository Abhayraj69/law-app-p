const helmet = require('helmet');

/**
 * Security Headers
 *
 * Everything here is defence against a browser being tricked into doing
 * something on a signed-in user's behalf. That matters more in this app
 * than in most: the session token lives in localStorage (see Auth in
 * app.js), so any script that runs on this origin can read it and walk
 * away with a valid session. The Content-Security-Policy below is what
 * stops injected markup from becoming a running script in the first
 * place.
 *
 * NOTE for anyone adding frontend code: `script-src` is 'self' with NO
 * 'unsafe-inline'. That means an inline <script> block or an
 * onclick="..." attribute will silently not run. This is deliberate, and
 * the app is written to suit it — every interactive element goes through
 * the data-action delegation layer at the top of app.js. If you find
 * yourself wanting to relax this directive, add a data-action instead.
 */

// style-src keeps 'unsafe-inline' — a deliberate, narrower exception.
// The markup carries several hundred inline style="..." attributes, and
// an injected style attribute cannot exfiltrate a token or call the API
// the way an injected script can. Removing them is worth doing, but it
// is a CSS refactor, not a security fix, and holding the script-src
// tightening hostage to it would have been the wrong trade.
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
  // blob: — document previews and downloads go through
  // URL.createObjectURL; data: — inline SVG/avatar placeholders.
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],

  // Belt and braces with script-src above: this one specifically blocks
  // inline event-handler ATTRIBUTES (onclick="...") as opposed to inline
  // <script> blocks. helmet sets it by default; it is repeated here
  // because it is the directive that actually enforces the data-action
  // convention the frontend is written around, and leaving it implicit
  // would make it easy to lose silently.
  scriptSrcAttr: ["'none'"]
};

function buildCsp() {
  const directives = { ...CSP_DIRECTIVES };

  // helmet merges these over its own defaults, and one of those defaults
  // is upgrade-insecure-requests. That is right in production and wrong
  // on a plain http://localhost dev server, so it is explicitly removed
  // (null, helmet's documented way to drop a default) rather than just
  // left unset — leaving it unset keeps helmet's default, which was the
  // opposite of what this conditional intends.
  directives.upgradeInsecureRequests =
    process.env.NODE_ENV === 'development' ? null : [];

  return directives;
}

/**
 * Returns the middleware stack to mount ahead of every route.
 */
function securityHeaders() {
  return [
    helmet({
      contentSecurityPolicy: { directives: buildCsp() },

      // The API serves user-uploaded files. Without nosniff, a browser
      // can decide an "image" is really HTML and render it on this
      // origin, which is same-origin script execution by another name.
      noSniff: true,

      // Clickjacking: the app is never meant to be framed. Belt and
      // braces with frame-ancestors 'none' above, for older browsers
      // that honour X-Frame-Options but not CSP level 2.
      frameguard: { action: 'deny' },

      // Don't leak document ids, case ids or tokens in a Referer header
      // when a user follows a link off-site.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

      // HSTS only outside development — sending it from a localhost dev
      // server pins the browser to HTTPS for that host and makes plain
      // http://localhost unusable afterwards, which is a genuinely
      // annoying thing to do to a developer's browser profile.
      hsts: process.env.NODE_ENV !== 'development'
        ? { maxAge: 31536000, includeSubDomains: true, preload: false }
        : false,

      // Cross-origin isolation headers are left at helmet's defaults
      // except COEP, which is disabled: it would block the Google Fonts
      // stylesheet, and the app has no SharedArrayBuffer//wasm-threads
      // use that would benefit from it.
      crossOriginEmbedderPolicy: false
    })
  ];
}

module.exports = { securityHeaders, CSP_DIRECTIVES, buildCsp };
