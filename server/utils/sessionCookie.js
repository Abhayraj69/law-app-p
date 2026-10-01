/**
 * Session cookie helpers (T16 in docs/DEPLOYMENT_TASKS.md).
 *
 * The session JWT used to be handed to the client in the login response
 * body and stored in localStorage, where any script that executes on the
 * origin can read it and walk away with a valid twelve-hour session. It is
 * now delivered ONLY via a Set-Cookie header with HttpOnly (so page
 * JavaScript — including an XSS payload — cannot read it at all) and never
 * appears in a JSON response body again.
 *
 * Because the API is same-origin with the frontend it serves, SameSite=
 * Strict alone blocks cross-site request forgery: a cookie marked Strict
 * is never sent on a request that originates from another site, so no
 * separate CSRF token is needed while that holds. This assumes the
 * deployment is same-origin (the default); a split-frontend deployment
 * using ALLOWED_ORIGINS for cross-origin API calls is a different trust
 * model this cookie is not designed for.
 */

const COOKIE_NAME = 'slf_session';

// Matches authService.TOKEN_TTL (12h), expressed in milliseconds since
// cookie maxAge and jsonwebtoken's expiresIn use incompatible units.
const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    // Secure cookies are silently dropped by the browser over plain HTTP,
    // which is exactly the case in local development — only require it
    // outside development, the same "outside dev" rule this app already
    // applies to HSTS, ClamAV and KMS.
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'strict',
    path: '/'
  };
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: COOKIE_MAX_AGE_MS });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

module.exports = { COOKIE_NAME, setSessionCookie, clearSessionCookie };
