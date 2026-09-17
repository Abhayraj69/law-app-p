/* ═══════════════════════════════════════════════════
   SLF – app.js
   All interactivity, data, and dynamic rendering
   ═══════════════════════════════════════════════════ */

'use strict';

// ══════════════════════════════════════
// DATA LAYER
//
// STATUS: Dashboard, Active Cases, Client Communications, and the global
// omnibox search now all talk to the real backend
// (server/services/{dashboardService,caseService,communicationsService,
// searchService}.js) the same way the Document Vault page always has.
// CASES and CONVERSATIONS below start empty and are populated by
// loadCases()/loadConversations() (ApiClient calls), not literals; the
// omnibox search has no equivalent module-level array at all any more —
// see initSearch() below, which calls GET /api/v1/search directly.
// See README.md for the current real-vs-mock breakdown.
// ══════════════════════════════════════

let CASES = [];
let HEARINGS = [];
let MESSAGES = [];
let BILLING_DATA = [];
let ACTIVITIES = [];
let NOTIFICATIONS = [];
let INVOICES = [];

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════

const $ = (id) => document.getElementById(id);
const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

// ══════════════════════════════════════
// EVENT DELEGATION
//
// Every interactive element in this app is wired through data-action
// attributes and the single delegated listener at the bottom of this
// section, rather than inline onclick="..."/onsubmit="..." attributes.
//
// Two reasons, and the second is the one that actually matters:
//
// 1. Content-Security-Policy. The server sends a CSP with a script-src of
//    'self' and no 'unsafe-inline' (see server/server.js). An inline
//    handler attribute is script, so under that policy every one of them
//    silently stops firing. Allowing 'unsafe-inline' instead would have
//    given up most of what the CSP is for.
//
// 2. Stored XSS. The inline handlers these replaced interpolated live
//    database values straight into executable attribute text — e.g. an
//    onclick of   handleCaseAction('open', CASE_ID, CASE_NAME)   built by
//    string interpolation. A case named
//        O'Brien'); alert(1); ('
//    closed the quoted argument and ran the rest as code
//    for every user who loaded the Active Cases page. Passing the same
//    values as data-* attributes makes them inert data: they are still
//    escaped on the way in (escapeAttr below), but a break-out now
//    produces a broken attribute, not execution.
//
// Handlers receive (element, event) and read their arguments off
// element.dataset, so nothing user-supplied is ever parsed as code.
// ══════════════════════════════════════

const ACTION_HANDLERS = Object.create(null);

// Registers one or many named actions. Called in small groups next to the
// code each action belongs to, so a handler stays near its markup.
function registerActions(handlers) {
  for (const [name, fn] of Object.entries(handlers)) {
    if (ACTION_HANDLERS[name]) {
      console.warn(`[actions] duplicate action registration: ${name}`);
    }
    ACTION_HANDLERS[name] = fn;
  }
}

// Escapes a value for safe interpolation into a double-quoted HTML
// attribute. Same escaping as escapeHtml (which is defined further down
// and hoists); named separately because the intent at the call site is
// "this is going into an attribute", which is where the old inline
// handlers went wrong.
function escapeAttr(value) {
  return escapeHtml(value);
}

// A data-action element that is also a link or a submit button would
// otherwise navigate/submit as well as run its handler.
function shouldPreventDefault(el) {
  return el.tagName === 'A' || el.tagName === 'FORM' || el.type === 'submit';
}

function dispatchAction(event) {
  const el = event.target.closest('[data-action]');
  if (!el) return;

  const name = el.dataset.action;
  const handler = ACTION_HANDLERS[name];
  if (!handler) {
    console.warn(`[actions] no handler registered for "${name}"`);
    return;
  }

  if (shouldPreventDefault(el)) event.preventDefault();

  // data-stop-propagation="true" replaces the handful of old handlers
  // that began with a literal event.stopPropagation() — e.g. a case-name
  // link inside a row that is itself clickable.
  if (el.dataset.stopPropagation === 'true') event.stopPropagation();

  try {
    handler(el, event);
  } catch (err) {
    console.error(`[actions] handler "${name}" threw:`, err);
  }
}

function initEventDelegation() {
  // Both listeners are attached once, at the document level, so markup
  // rendered later (every innerHTML in this file) is wired automatically
  // with no re-binding step.
  document.addEventListener('click', dispatchAction);
  document.addEventListener('submit', dispatchAction);
}

// Every action used anywhere in index.html or in this file's rendered
// markup. Registered in one place so an unreferenced action or a typo in
// a data-action is easy to spot; the handlers themselves are ordinary
// function declarations defined further down and hoisted.
registerActions({
  // Navigation
  'navigate': (el) => navigateToPage(el.dataset.page),

  // Generic UI
  'toast': (el) => showToast(el.dataset.message, el.dataset.tone || 'info'),
  'toggle-actions-dropdown': (el, event) => toggleActionsDropdown(event, el.dataset.key),

  // Communications
  'send-comms-message': (el, event) => handleSendCommsMessage(event),
  'comms-quick-action': (el, event) => handleInputQuickAction(el.dataset.quick, event),
  'select-conversation': (el) => selectConversation(el.dataset.conversationId),
  'clear-comms-attachment': () => clearPendingCommsAttachment(),

  // Cases
  'submit-new-case': (el, event) => handleNewCaseSubmit(event),
  'submit-start-intake': (el, event) => handleStartIntakeSubmit(event),
  'case-action': (el) => handleCaseAction(el.dataset.caseAction, el.dataset.caseId, el.dataset.caseName),
  'set-cases-page': (el) => setCasesPage(Number(el.dataset.pageNumber)),
  'open-case-detail': (el) => openCaseDetailModal(el.dataset.caseId, el.dataset.caseName),

  // Billing
  'submit-invoice': (el, event) => handleInvoiceSubmit(event),
  'open-invoice-modal': (el) => openInvoiceModal(el.dataset.invoiceId),
  'invoice-mark-paid': (el) => handleInvoiceMarkPaid(el.dataset.invoiceId, el.dataset.invoiceNumber),
  'set-billing-page': (el) => setBillingPage(Number(el.dataset.pageNumber)),

  // Trust accounting
  'submit-trust-ledger': (el, event) => handleTrustLedgerSubmit(event),
  'submit-trust-entry': (el, event) => handleTrustEntrySubmit(event),
  'submit-trust-transfer': (el, event) => handleTrustTransferSubmit(event),
  'open-trust-entry': (el) => openTrustEntryModal(el.dataset.ledgerId, el.dataset.entryType),
  'open-trust-transfer': (el) => openTrustTransferModal(el.dataset.ledgerId),
  'open-trust-history': (el) => openTrustHistoryModal(el.dataset.ledgerId),
  'trust-reverse': (el) => handleTrustReverse(el.dataset.transactionId, el.dataset.ledgerId),

  // Signatures
  'submit-signature-request': (el, event) => handleSignatureRequestSubmit(event),

  // Settings / admin
  'submit-invite-user': (el, event) => handleInviteUserSubmit(event),
  'set-audit-log-page': (el) => setAuditLogPage(Number(el.dataset.pageNumber)),

  // Document vault
  'preview-document': (el) => handlePreview(el.dataset.documentId),
  'open-context-menu': (el, event) => openContextMenu(event, el.dataset.documentId),
  'open-document-detail': (el) => openDocumentDetailModal(el.dataset.documentId, el.dataset.fileName),
  'download-version': (el) => downloadDocumentVersion(el.dataset.versionId),
  'select-folder': (el) => selectFolder(el.dataset.folderId, el.dataset.folderName),
  'reset-folder': () => resetFolder(),
  'remove-upload-file': (el) => removeUploadFile(Number(el.dataset.index)),
  'vault-page-prev': () => { VaultState.currentPage--; loadVaultFiles(); },
  'vault-page-next': () => { VaultState.currentPage++; loadVaultFiles(); },

  // Modals and drawers
  'close-vault-modal': (el) => closeVaultModal(el.dataset.modal),
  'close-vault-drawer': (el) => closeVaultDrawer(el.dataset.drawer),
  'close-share-drawer': () => closeShareDrawer(),
  'close-copilot-drawer': () => closeCopilotDrawer(),
});

// ══════════════════════════════════════
// AUTHENTICATION
// The app previously had no login of any kind — the backend defaulted
// every request to a hardcoded user. It now issues a signed JWT on login
// and requires it (as an Authorization: Bearer header) on every API call.
// This module owns the token lifecycle on the client: storing it,
// attaching it to requests, and locking the UI behind the login overlay
// whenever there is no valid session.
// ══════════════════════════════════════

const Auth = {
  TOKEN_KEY: 'slf_auth_token',
  USER_KEY: 'slf_auth_user',

  getToken() {
    try { return localStorage.getItem(this.TOKEN_KEY); } catch { return null; }
  },
  getUser() {
    try { return JSON.parse(localStorage.getItem(this.USER_KEY) || 'null'); } catch { return null; }
  },
  setSession(token, user) {
    try {
      localStorage.setItem(this.TOKEN_KEY, token);
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    } catch { /* localStorage unavailable (private mode, etc.) — session just won't persist */ }
  },
  clearSession() {
    try {
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.USER_KEY);
    } catch { /* ignore */ }
  },
  authHeader() {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
};

// Mirrors the server's requireRole('ASSOCIATE') floor on DELETE
// /api/v1/files/:id and PATCH /api/v1/cases/:id/archive (server/routes/api.js)
// — PARALEGAL is the only role below that floor (CLIENT never reaches this
// SPA at all, see initAuth). Reads the same cached session user that
// applyUserToChrome/initAuth already populate, rather than a separate
// role-checking mechanism.
function isParalegal() {
  const user = Auth.getUser();
  return !!user && user.role === 'PARALEGAL';
}

// Mirrors the server's requireRole('ASSOCIATE') floor on POST /api/v1/invoices
// and PATCH /api/v1/invoices/:id (server/routes/api.js) — same floor and
// same PARALEGAL exception as isParalegal() above, just phrased positively
// since it gates showing a control rather than hiding one.
function canManageBilling() {
  return !isParalegal();
}

// Mirrors the server's requireRole('PARTNER') floor on
// PATCH /api/v1/invoices/:id/mark-paid — stricter than canManageBilling()
// above because marking an invoice paid is a financial attestation that
// money was actually received, not a metadata edit.
function canMarkInvoicesPaid() {
  const role = Auth.getUser() && Auth.getUser().role;
  return role === 'PARTNER' || role === 'SENIOR_PARTNER' || role === 'ADMIN';
}

// Mirrors the server's requireRole('PARTNER') floor on every /api/v1/trust/*
// route (server/routes/api.js) — trust accounting is restricted to the
// roles who bear bar-discipline responsibility for client funds, not
// opened to every staff role the way billing is. Same three roles as
// canMarkInvoicesPaid above, just named for its own gate.
function canManageTrust() {
  const role = Auth.getUser() && Auth.getUser().role;
  return role === 'PARTNER' || role === 'SENIOR_PARTNER' || role === 'ADMIN';
}

function showAuthOverlay(message) {
  document.body.classList.add('auth-locked');
  const errBox = $('authError');
  if (errBox) {
    if (message) {
      errBox.textContent = message;
      errBox.classList.remove('hidden');
    } else {
      errBox.classList.add('hidden');
    }
  }
}

function hideAuthOverlay() {
  document.body.classList.remove('auth-locked');
}

// Reflect the signed-in user's identity into the sidebar/topbar chrome,
// which previously always showed the hardcoded "Sarah Jennings" demo user
// regardless of who was actually using the app.
function applyUserToChrome(user) {
  if (!user) return;
  const roleLabels = {
    CLIENT: 'Client', PARALEGAL: 'Paralegal', ASSOCIATE: 'Associate',
    PARTNER: 'Partner, Esq.', SENIOR_PARTNER: 'Senior Partner, Esq.', ADMIN: 'Administrator'
  };
  const initials = user.initials || user.full_name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const roleLabel = roleLabels[user.role] || user.role;

  if ($('sidebarUserAvatar')) $('sidebarUserAvatar').textContent = initials;
  if ($('sidebarUserName')) $('sidebarUserName').textContent = user.full_name;
  if ($('sidebarUserRole')) $('sidebarUserRole').textContent = roleLabel;
  if ($('topbarUserAvatar')) $('topbarUserAvatar').textContent = initials;
  if ($('dropdownUserAvatar')) $('dropdownUserAvatar').textContent = initials;
  if ($('dropdownUserName')) $('dropdownUserName').textContent = `${user.full_name}, Esq.`;
  if ($('dropdownUserEmail')) $('dropdownUserEmail').textContent = user.email;

  applyRolePermissionsToChrome(user);
}

// Hides the delete entry points a PARALEGAL would otherwise see and then
// get bounced off with a raw 403 toast: the bulk-action-bar Delete button
// and the per-row context-menu Delete item (plus its now-orphaned divider).
// The Archive Case button is handled separately, in renderCasesList, since
// it's rebuilt from scratch per row on every render rather than living as
// static markup like these two.
function applyRolePermissionsToChrome(user) {
  const restricted = user && user.role === 'PARALEGAL';
  if ($('bulkDelete')) $('bulkDelete').classList.toggle('hidden', restricted);
  if ($('ctxDelete')) $('ctxDelete').classList.toggle('hidden', restricted);
  const ctxDeleteDivider = $('ctxDelete')?.previousElementSibling;
  if (ctxDeleteDivider && ctxDeleteDivider.classList.contains('ctx-divider')) {
    ctxDeleteDivider.classList.toggle('hidden', restricted);
  }

  // Trust Accounting nav item starts hidden in the markup (only
  // PARTNER/SENIOR_PARTNER/ADMIN should even know the nav entry exists) —
  // see canManageTrust()'s comment on why this floor is stricter than
  // billing's.
  if ($('navTrustItem')) $('navTrustItem').classList.toggle('hidden', !canManageTrust());
}

// Called once at startup: trust a stored token only after the server
// confirms it's still valid (not expired, user still exists).
async function initAuth() {
  const token = Auth.getToken();
  if (!token) {
    showAuthOverlay();
    return;
  }
  // CLIENT-role users get a separate, simplified portal (see
  // client-portal.html/.js) — they never load this staff SPA. Checked
  // against the cached role first (synchronous, no flash of staff chrome
  // before redirecting) rather than waiting on the /auth/me round trip.
  const cachedUser = Auth.getUser();
  if (cachedUser && cachedUser.role === 'CLIENT') {
    window.location.href = '/portal';
    return;
  }
  try {
    const res = await fetch('/api/v1/auth/me', { headers: Auth.authHeader() });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Session expired.');
    Auth.setSession(token, json.data);
    applyUserToChrome(json.data);
    hideAuthOverlay();
    loadInitialAppData();
  } catch (err) {
    Auth.clearSession();
    showAuthOverlay();
  }
}

// Any 401 from the API (expired token, server restarted, etc.) drops the
// user back to the login screen instead of leaving the app silently broken.
function handleUnauthenticated() {
  Auth.clearSession();
  showAuthOverlay('Your session has expired. Please sign in again.');
}

document.addEventListener('DOMContentLoaded', () => {
  // First, before anything renders: every data-action in the app is dead
  // markup until this runs. See the EVENT DELEGATION section above.
  initEventDelegation();

  initAuth();

  const loginForm = $('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('loginEmail').value.trim();
      const password = $('loginPassword').value;
      const btn = $('loginSubmitBtn');
      const errBox = $('authError');
      errBox.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Signing in…';

      try {
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Sign in failed.');

        Auth.setSession(json.data.token, json.data.user);
        if (json.data.user.role === 'CLIENT') {
          window.location.href = '/portal';
          return;
        }
        applyUserToChrome(json.data.user);
        hideAuthOverlay();
        loadInitialAppData();
        loginForm.reset();
        if (typeof showToast === 'function') {
          showToast(`Welcome back, ${json.data.user.full_name.split(' ')[0]}!`, 'info');
        }
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });
  }

  const signOutBtn = $('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async (e) => {
      e.preventDefault();

      // Revoke the token server-side BEFORE dropping it locally, so
      // signing out actually ends the session everywhere rather than
      // just forgetting it in this browser. Clearing localStorage alone
      // left a copied token working for the rest of its 12-hour TTL.
      //
      // Best-effort: if the call fails (offline, server down) the local
      // session is still cleared, because refusing to log someone out
      // because the network is unavailable is the worse failure.
      try {
        await ApiClient.post('/api/v1/auth/logout', {});
      } catch (err) {
        console.warn('Server-side logout failed; clearing local session anyway.', err);
      }

      Auth.clearSession();
      const dd = $('profileDropdown');
      if (dd) dd.classList.remove('open');
      showAuthOverlay();
    });
  }
});

function formatCurrency(n) {
  if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'k';
  return '$' + n.toLocaleString();
}

// Invoice amounts are stored/transmitted in cents (see amount_cents on the
// API) so money never touches a float on the wire — this is the one place
// that turns them back into a full, exact dollar figure for display,
// unlike formatCurrency's abbreviated "$142k" KPI-card format above.
function formatMoney(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getStatusLabel(status) {
  const map = { active: 'Active', pending: 'Pending', review: 'In Review', closed: 'Closed' };
  return map[status] || status;
}

// ══════════════════════════════════════
// DATE / TIME
// ══════════════════════════════════════

function updateDate() {
  const pageDateEl = $('pageDate');
  if (pageDateEl) {
    pageDateEl.textContent = 'Thursday, July 23, 2026';
  }
}

// ══════════════════════════════════════
// SIDEBAR COLLAPSE
// ══════════════════════════════════════

function navigateToPage(page) {
  $$('.nav-item').forEach(i => i.classList.remove('active'));
  const activeNavItem = document.querySelector(`[data-page="${page}"]`);
  if (activeNavItem) {
    activeNavItem.classList.add('active');
  }

  const pageTitles = {
    dashboard:      'Dashboard Overview',
    cases:          'Active Cases',
    communications: 'Client Communications',
    documents:      'Document Vault',
    billing:        'Billing & Invoices',
    trust:          'Trust Accounting',
    settings:       'Settings',
  };
  $('pageTitle').textContent = pageTitles[page] || 'Document Vault';

  const dashboardPage = $('dashboardPage');
  const casesPage = $('casesPage');
  const commsPage = $('commsPage');
  const documentsPage = $('documentsPage');
  const billingPage = $('billingPage');
  const trustPage = $('trustPage');
  const settingsPage = $('settingsPage');
  const placeholder = $('placeholderPage');

  // Hide all main pages
  if (dashboardPage) dashboardPage.classList.add('hidden');
  if (casesPage) casesPage.classList.add('hidden');
  if (commsPage) commsPage.classList.add('hidden');
  if (documentsPage) documentsPage.classList.add('hidden');
  if (billingPage) billingPage.classList.add('hidden');
  if (trustPage) trustPage.classList.add('hidden');
  if (settingsPage) settingsPage.classList.add('hidden');
  if (placeholder) placeholder.classList.add('hidden');

  if (page === 'dashboard') {
    if (dashboardPage) {
      dashboardPage.classList.remove('hidden');
      loadDashboard();
    }
  } else if (page === 'documents') {
    if (documentsPage) {
      documentsPage.classList.remove('hidden');
      initDocumentVault();
    }
  } else if (page === 'cases') {
    if (casesPage) {
      casesPage.classList.remove('hidden');
      initCasesPage();
    }
  } else if (page === 'communications') {
    if (commsPage) {
      commsPage.classList.remove('hidden');
      initCommsPage();
    }
  } else if (page === 'billing') {
    if (billingPage) {
      billingPage.classList.remove('hidden');
      initBillingPage();
    }
  } else if (page === 'trust') {
    if (trustPage) {
      trustPage.classList.remove('hidden');
      initTrustPage();
    }
  } else if (page === 'settings') {
    if (settingsPage) {
      settingsPage.classList.remove('hidden');
      initSettingsPage();
    }
  } else {
    showPlaceholderPage(pageTitles[page] || page);
  }
}

function showPlaceholderPage(title) {
  let placeholder = $('placeholderPage');
  if (!placeholder) {
    placeholder = document.createElement('main');
    placeholder.id = 'placeholderPage';
    placeholder.className = 'content';
    $('mainWrapper').appendChild(placeholder);
  }
  placeholder.classList.remove('hidden');
  placeholder.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:60%; text-align:center; padding:40px;">
      <div style="background:rgba(201,168,76,0.1); border-radius:50%; width:80px; height:80px; display:flex; align-items:center; justify-content:center; margin-bottom:24px; border: 1px solid rgba(201,168,76,0.2)">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--gold-500)" stroke-width="1.5" style="width:36px; height:36px;">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
      </div>
      <h2 style="font-size:22px; font-weight:600; color:var(--white); margin-bottom:8px;">${title} Section</h2>
      <p style="font-size:14px; color:var(--slate-400); max-width:400px; line-height:1.6; margin-bottom:24px;">This section is currently under active development. Check back soon for features like full vault indexing, client communications, and real-time ledger management.</p>
      <button class="btn-primary" data-action="navigate" data-page="dashboard">Return to Dashboard</button>
    </div>
  `;
}

function initSidebar() {
  const sidebar = $('sidebar');
  const toggle = $('sidebarToggle');
  let collapsed = false;

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    sidebar.classList.toggle('collapsed', collapsed);
  });

  // Nav item clicks
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      navigateToPage(page);
    });
  });
}

// ══════════════════════════════════════
// PROFILE DROPDOWN
// ══════════════════════════════════════

function initProfileDropdown() {
  const btn = $('adminProfile');
  const dd = $('profileDropdown');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dd.classList.toggle('open');
    // close notifications if open
    $('notificationPanel').classList.remove('open');
    $('overlay').classList.remove('active');
  });

  document.addEventListener('click', () => dd.classList.remove('open'));
}

// ══════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════

function renderNotifications() {
  const list = $('notifList');
  const iconMap = {
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    msg:   '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
    doc:   '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  };

  list.innerHTML = NOTIFICATIONS.map(n => `
    <div class="notif-item ${n.unread ? 'unread' : ''}">
      <div class="notif-icon" style="background:${n.bgColor}; color:${n.color}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${iconMap[n.icon]}</svg>
      </div>
      <div class="notif-content">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-desc">${escapeHtml(n.desc)}</div>
        <div class="notif-time">${escapeHtml(n.time)}</div>
      </div>
    </div>
  `).join('');
}

function initNotifications() {
  renderNotifications();

  const btn = $('notificationBtn');
  const panel = $('notificationPanel');
  const overlay = $('overlay');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('open');
    overlay.classList.toggle('active', panel.classList.contains('open'));
    $('profileDropdown').classList.remove('open');
  });

  overlay.addEventListener('click', () => {
    panel.classList.remove('open');
    overlay.classList.remove('active');
  });

  $('notifClear').addEventListener('click', () => {
    $$('.notif-item').forEach(i => i.classList.remove('unread'));
    const dot = $('notificationBtn').querySelector('.notification-dot');
    if (dot) { dot.textContent = '0'; dot.style.display = 'none'; }
  });
}

// ══════════════════════════════════════
// GLOBAL SEARCH
// ══════════════════════════════════════

// Debounced, cancellation-aware: a fast typist firing several keystrokes
// in a row must never have an earlier (slower) response clobber a later
// one — requestSeq tags each call and a response is only rendered if it's
// still the most recent one in flight by the time it resolves.
function initSearch() {
  const input = $('globalSearch');
  const results = $('searchResults');
  if (!input || !results) return;

  const iconMap = {
    case:     '<path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>',
    client:   '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    document: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
  };
  const colorMap = { case: '#C9A84C', client: '#3B82F6', document: '#2DC8B0' };
  const bgMap    = { case: 'rgba(201,168,76,0.15)', client: 'rgba(59,130,246,0.15)', document: 'rgba(45,200,176,0.15)' };

  let debounceTimer = null;
  let requestSeq = 0;

  function showMessage(text, color) {
    results.innerHTML = `<div style="padding:16px;text-align:center;color:${color || 'var(--slate-400)'};font-size:13px">${escapeHtml(text)}</div>`;
    results.classList.add('visible');
  }

  function renderResults(items) {
    if (!items.length) { showMessage('No results found.'); return; }

    results.innerHTML = items.map(d => `
      <div class="search-result-item">
        <div class="search-result-icon" style="background:${bgMap[d.type]}; color:${colorMap[d.type]}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${iconMap[d.type] || ''}</svg>
        </div>
        <div>
          <div class="result-name">${escapeHtml(d.name)}</div>
          <div class="result-meta">${escapeHtml(d.meta)}</div>
        </div>
      </div>
    `).join('');

    results.classList.add('visible');
  }

  async function runSearch(q) {
    const seq = ++requestSeq;
    showMessage('Searching…');
    try {
      const data = await ApiClient.get(`/api/v1/search?q=${encodeURIComponent(q)}&limit=6`);
      if (seq !== requestSeq) return; // superseded by a newer keystroke
      renderResults(data.results || []);
    } catch (err) {
      if (seq !== requestSeq) return;
      console.error('Search error:', err);
      showMessage(`Search failed: ${err.message}`, '#E74C3C');
    }
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if (!q) {
      requestSeq++; // invalidate any response still in flight
      results.classList.remove('visible');
      return;
    }
    debounceTimer = setTimeout(() => runSearch(q), 250);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => results.classList.remove('visible'), 150);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { results.classList.remove('visible'); input.blur(); }
  });
}

// ══════════════════════════════════════
// STAT CARD COUNT-UP ANIMATION
// ══════════════════════════════════════

function animateCountUp() {
  $$('[data-target]').forEach(el => {
    const target = parseInt(el.dataset.target, 10);
    const isCurrency = el.classList.contains('currency');
    const duration = 1200;
    const start = performance.now();

    function update(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(eased * target);

      // Previously hardcoded a literal ",600" suffix onto every currency
      // value at animation end — an artifact of the one demo number
      // (142,600) this used to always render, which silently mis-formatted
      // any other value. toLocaleString formats whatever number actually
      // arrives from the API.
      el.textContent = isCurrency ? current.toLocaleString('en-US') : current;

      if (progress < 1) requestAnimationFrame(update);
      else el.textContent = isCurrency ? target.toLocaleString('en-US') : target;
    }

    // Start after a short delay
    setTimeout(() => requestAnimationFrame(update), 300);
  });
}

// Pushes real KPI numbers from GET /api/v1/dashboard/summary into the
// four stat-card [data-target] elements (Active Cases, Pending Documents,
// Unread Messages, Revenue YTD), in that DOM order, then re-runs the
// existing count-up animation against the new targets.
function renderDashboardKpis(kpis) {
  const targets = [kpis.active_cases, kpis.pending_documents, kpis.unread_messages, kpis.revenue_ytd];
  $$('.stat-value[data-target]').forEach((el, i) => {
    if (targets[i] !== undefined && targets[i] !== null) el.dataset.target = targets[i];
  });
  animateCountUp();
}

// ══════════════════════════════════════
// LIVE DATA LOADERS
// Dashboard, Active Cases and Client Communications now pull from the
// real backend (server/services/{dashboardService,caseService,
// communicationsService}.js) the same way the Document Vault page always
// has — see ApiClient below and the DATA LAYER note near the top of this
// file. Called once auth succeeds (loadInitialAppData) and again whenever
// a page is (re)visited, matching initDocumentVault's re-fetch-on-visit
// pattern.
// ══════════════════════════════════════

// A DATE column comes back from the API as a plain 'YYYY-MM-DD' string
// (see server/db/pool.js). Parsed via the LOCAL Date constructor — NOT
// `new Date(dateStr)`, which the spec treats as UTC midnight and would
// shift the calendar day on any browser whose local timezone is behind
// UTC — so `.getMonth()`/`.getDate()` (both local methods, used by
// renderCalendar below) always agree with the date as entered.
function parseDateOnly(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

async function loadDashboard() {
  try {
    const data = await ApiClient.get('/api/v1/dashboard/summary');
    renderDashboardKpis(data.kpis);

    BILLING_DATA = data.billing_chart;
    renderBillingChart();

    HEARINGS = data.hearings.map(h => ({ ...h, fullDate: parseDateOnly(h.fullDate) }));
    renderCalendar();
    renderHearings();

    MESSAGES = data.messages;
    renderMessages();

    ACTIVITIES = data.activity;
    renderActivityFeed();
  } catch (err) {
    console.error('Dashboard load error', err);
  }
}

// Backs both the dashboard's "Recent Case Activity" mini table
// (caseTableBody / renderCaseTable) and the full Active Cases page table
// (casesLargeTableBody / renderCasesList) — both read from the same
// CASES array, same as when it was a hardcoded fixture.
async function loadCases() {
  try {
    CASES = await ApiClient.get('/api/v1/cases');
    filteredCases = [...CASES];
    currentPage = 1;
    renderCaseTable();
    casesCurrentPage = 1;
    renderCasesList();
  } catch (err) {
    console.error('Cases load error', err);
    const tbody = $('casesLargeTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--slate-400)">Error loading cases</td></tr>`;
  }
}

async function loadConversations() {
  try {
    CONVERSATIONS = await ApiClient.get('/api/v1/conversations');
    if (!CONVERSATIONS.find(c => c.id === activeConvId)) {
      activeConvId = CONVERSATIONS.length ? CONVERSATIONS[0].id : null;
    }
    renderCommsSidebar();
    if (activeConvId) {
      await loadConversationDetail(activeConvId);
    } else {
      renderActiveChat();
    }
  } catch (err) {
    console.error('Conversations load error', err);
  }
}

// Fetches the full message thread for one conversation (GET returns
// role-scoped messages — notes stripped server-side for a CLIENT caller,
// see communicationsService.js) and merges it into the matching
// CONVERSATIONS entry so renderActiveChat can keep reading from that
// array the way it always has.
async function loadConversationDetail(id) {
  try {
    const detail = await ApiClient.get(`/api/v1/conversations/${id}`);
    const idx = CONVERSATIONS.findIndex(c => c.id === id);
    if (idx !== -1) {
      CONVERSATIONS[idx] = { ...CONVERSATIONS[idx], ...detail, unread: 0 };
    } else {
      CONVERSATIONS.push({ ...detail, unread: 0 });
    }
    renderCommsSidebar();
    renderActiveChat();
  } catch (err) {
    console.error('Conversation detail load error', err);
  }
}

async function loadInitialAppData() {
  await Promise.all([loadDashboard(), loadCases()]);
}

// ══════════════════════════════════════
// CASE TABLE
// ══════════════════════════════════════

let currentPage = 1;
const PAGE_SIZE = 8;
let filteredCases = [...CASES];

function renderCaseTable() {
  const tbody = $('caseTableBody');
  const start = (currentPage - 1) * PAGE_SIZE;
  const slice = filteredCases.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = slice.map(c => `
    <tr>
      <td>
        <div class="case-name" title="${escapeAttr(c.name)}">${escapeHtml(c.name)}</div>
        <div style="font-size:11px;color:var(--slate-400);margin-top:2px">${escapeHtml(c.id)}</div>
      </td>
      <td class="case-client">${escapeHtml(c.client)}</td>
      <td><span class="status-badge ${c.status}">${getStatusLabel(c.status)}</span></td>
      <td>
        <div class="attorney-cell">
          <div class="attorney-avatar" style="background:${c.color}22;color:${c.color}">${escapeHtml(c.initials)}</div>
          ${escapeHtml(c.attorney)}
        </div>
      </td>
      <td class="activity-time">${escapeHtml(c.activity)}</td>
      <td>
        <button class="row-action" aria-label="More actions for ${escapeAttr(c.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');

  const total = filteredCases.length;
  const end = Math.min(start + PAGE_SIZE, total);
  $('showingText').textContent = total ? `Showing ${start + 1}–${end} of ${total}` : 'No cases found';
  $('prevPage').disabled = currentPage === 1;
  $('nextPage').disabled = end >= total;
}

function initCaseTable() {
  renderCaseTable();

  $('caseSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    filteredCases = CASES.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.client.toLowerCase().includes(q) ||
      c.status.toLowerCase().includes(q) ||
      c.attorney.toLowerCase().includes(q)
    );
    currentPage = 1;
    renderCaseTable();
  });

  $('prevPage').addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderCaseTable(); } });
  $('nextPage').addEventListener('click', () => {
    if (currentPage * PAGE_SIZE < filteredCases.length) { currentPage++; renderCaseTable(); }
  });

  // Sortable headers
  $$('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      const colMap = { name: 'name', client: 'client', activity: 'activity' };
      const key = colMap[col];
      filteredCases.sort((a, b) => a[key].localeCompare(b[key]));
      currentPage = 1;
      renderCaseTable();
    });
  });
}

// ══════════════════════════════════════
// CALENDAR
// ══════════════════════════════════════

let calYear = new Date().getFullYear(), calMonth = new Date().getMonth();

function renderCalendar() {
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();
  const today = new Date();

  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('calMonthLabel').textContent = `${months[calMonth]} ${calYear}`;

  // Mark hearing days
  const hearingDays = new Set(HEARINGS
    .filter(h => h.fullDate.getMonth() === calMonth && h.fullDate.getFullYear() === calYear)
    .map(h => h.day)
  );

  let html = '';

  // Previous month days
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month">${daysInPrev - i}</div>`;
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
    const hasHearing = hearingDays.has(d);
    let cls = 'cal-day';
    if (isToday) cls += ' today';
    if (hasHearing) cls += ' has-hearing';
    html += `<div class="${cls}" data-day="${d}">${d}</div>`;
  }

  // Next month days
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  let next = 1;
  for (let i = firstDay + daysInMonth; i < totalCells; i++) {
    html += `<div class="cal-day other-month">${next++}</div>`;
  }

  $('calDays').innerHTML = html;

  // Click handler
  $$('.cal-day:not(.other-month)', $('calDays')).forEach(el => {
    el.addEventListener('click', () => {
      $$('.cal-day').forEach(d => d.classList.remove('selected'));
      el.classList.add('selected');
    });
  });
}

function renderHearings() {
  const list = $('hearingsList');
  const typeLabels = { urgent: 'Hearing', normal: 'Conference', deadline: 'Filing Deadline' };
  list.innerHTML = HEARINGS.slice(0, 4).map(h => `
    <div class="hearing-item ${h.type}">
      <div class="hearing-date-block">
        <span class="hearing-date-month">${h.month}</span>
        <span class="hearing-date-day">${h.day}</span>
      </div>
      <div class="hearing-info">
        <div class="hearing-case">${escapeHtml(h.case)}</div>
        <div class="hearing-meta">${typeLabels[h.type]} · ${escapeHtml(h.room)}</div>
      </div>
      <div class="hearing-time">${escapeHtml(h.time)}</div>
    </div>
  `).join('');
}

function initCalendar() {
  renderCalendar();
  renderHearings();

  $('prevMonth').addEventListener('click', () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });

  $('nextMonth').addEventListener('click', () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });
}

// ══════════════════════════════════════
// MESSAGES
// ══════════════════════════════════════

function renderMessages() {
  const list = $('messagesList');
  list.innerHTML = MESSAGES.map(m => `
    <div class="message-item ${m.unreadItem ? 'unread' : ''}">
      <div class="msg-avatar" style="background:${m.color}22; color:${m.color}">${escapeHtml(m.initials)}</div>
      <div class="message-content">
        <div class="message-name">${escapeHtml(m.name)}</div>
        <div class="message-preview">${escapeHtml(m.preview)}</div>
      </div>
      <div class="message-meta">
        <span class="message-time">${escapeHtml(m.time)}</span>
        ${m.unread ? `<span class="message-unread-count">${m.unread}</span>` : ''}
      </div>
    </div>
  `).join('');

  $$('.message-item').forEach(item => {
    item.addEventListener('click', () => item.classList.remove('unread'));
  });
}

// ══════════════════════════════════════
// BILLING CHART
// ══════════════════════════════════════

function renderBillingChart() {
  const maxVal = Math.max(...BILLING_DATA.map(d => d.value));
  const container = $('chartBars');

  container.innerHTML = BILLING_DATA.map((d, i) => {
    const pct = (d.value / 60000) * 100;
    return `
      <div class="chart-bar-group">
        <div class="chart-bar" style="height:0%;" data-value="${formatCurrency(d.value)}" data-index="${i}" data-pct="${pct.toFixed(1)}"></div>
        <span class="chart-month-label">${d.month}</span>
      </div>
    `;
  }).join('');

  // Animate bars
  setTimeout(() => {
    $$('.chart-bar').forEach(bar => {
      const pct = bar.dataset.pct;
      bar.style.transition = `height 0.7s cubic-bezier(0.4,0,0.2,1) ${parseInt(bar.dataset.index) * 0.08}s`;
      bar.style.height = pct + '%';
    });
  }, 400);

  // Tab switching
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Shuffle values for demo
      $$('.chart-bar').forEach(bar => {
        const newH = (Math.random() * 60 + 20).toFixed(1);
        bar.style.height = newH + '%';
      });
    });
  });
}

// ══════════════════════════════════════
// ACTIVITY FEED
// ══════════════════════════════════════

function renderActivityFeed() {
  const feed = $('activityFeed');
  const iconMap = {
    doc:     '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
    msg:     '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
    case:    '<path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>',
    billing: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
    alert:   '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  };

  feed.innerHTML = ACTIVITIES.map(a => `
    <div class="activity-item">
      <div class="activity-icon ${a.icon}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${iconMap[a.icon]}</svg>
      </div>
      <div class="activity-content">
        <div class="activity-text">${escapeHtml(a.text)}</div>
        <div class="activity-time-tag">${escapeHtml(a.time)}</div>
      </div>
    </div>
  `).join('');
}

// ══════════════════════════════════════
// NEW CASE BUTTON
// ══════════════════════════════════════

function initNewCaseButton() {
  $('newCaseBtn').addEventListener('click', () => {
    navigateToPage('cases');
    setTimeout(() => openNewCaseModal(), 150);
  });

  $('filterBtn').addEventListener('click', () => {
    navigateToPage('cases');
  });

  $('viewAllMsgs').addEventListener('click', () => {
    navigateToPage('communications');
  });

  // Modal close triggers
  $('modalCloseBtn').addEventListener('click', closeNewCaseModal);
  $('modalCancelBtn').addEventListener('click', closeNewCaseModal);
  
  // Close modal on click outside modal-box
  $('newCaseModal').addEventListener('click', (e) => {
    if (e.target === $('newCaseModal')) {
      closeNewCaseModal();
    }
  });
}

/* ════════════════════════════════════════════
   ACTIVE CASES RENDERING & MANAGEMENT LOGIC
   ════════════════════════════════════════════ */

let casesSearchQuery = "";
let casesStatusFilter = "all";
let casesAreaFilter = "all";
let casesAttorneyFilter = "all";
let casesDateFilter = "all";
let casesCurrentPage = 1;
const CASES_PAGE_SIZE = 6;
let casesSortColumn = "id";
let casesSortDirection = "asc";
let casesListenersInitialized = false;

function initCasesPage() {
  // Same requireRole('ASSOCIATE') floor as Archive Case / POST
  // /api/v1/cases/intake (server/routes/api.js) — PARALEGAL is the only
  // staff role below it.
  if ($('casesPageStartIntakeBtn')) $('casesPageStartIntakeBtn').classList.toggle('hidden', isParalegal());
  renderCasesList();
  setupCasesPageListeners();
  loadCases(); // re-fetch on every visit, same pattern as initDocumentVault
}

function renderCasesList() {
  const tbody = $('casesLargeTableBody');
  const emptyState = $('casesEmptyState');
  const table = $('casesLargeTable');
  
  if (!tbody) return;

  // Filter cases
  let results = CASES.filter(c => {
    const q = casesSearchQuery.toLowerCase();
    const matchesSearch = !q || 
      c.id.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.client.toLowerCase().includes(q) ||
      c.opposingParty.toLowerCase().includes(q) ||
      c.opposingCounsel.toLowerCase().includes(q) ||
      c.type.toLowerCase().includes(q);

    const matchesStatus = casesStatusFilter === 'all' || c.status === casesStatusFilter;
    const matchesArea = casesAreaFilter === 'all' || c.type === casesAreaFilter;
    const matchesAttorney = casesAttorneyFilter === 'all' || c.attorney === casesAttorneyFilter;

    let matchesDate = true;
    if (casesDateFilter !== 'all') {
      const now = new Date();
      const caseDate = c.createdDate || new Date();
      const diffTime = Math.abs(now - caseDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      matchesDate = diffDays <= parseInt(casesDateFilter, 10);
    }

    return matchesSearch && matchesStatus && matchesArea && matchesAttorney && matchesDate;
  });

  // Sort cases
  results.sort((a, b) => {
    let valA, valB;
    if (casesSortColumn === 'id') {
      valA = a.id;
      valB = b.id;
    } else if (casesSortColumn === 'client') {
      valA = a.client;
      valB = b.client;
    } else if (casesSortColumn === 'hearing') {
      valA = a.nextHearing === 'None' ? 'ZZZZ' : a.nextHearing;
      valB = b.nextHearing === 'None' ? 'ZZZZ' : b.nextHearing;
    } else {
      valA = a.name;
      valB = b.name;
    }

    let comparison = valA.localeCompare(valB);
    return casesSortDirection === 'asc' ? comparison : -comparison;
  });

  // Toggle empty state
  if (results.length === 0) {
    emptyState.classList.remove('hidden');
    table.classList.add('hidden');
    $('casesShowingText').textContent = 'No cases found';
    $('casesPrevPage').disabled = true;
    $('casesNextPage').disabled = true;
    $('casesPageNumbers').innerHTML = '';
    return;
  } else {
    emptyState.classList.add('hidden');
    table.classList.remove('hidden');
  }

  // Paginate
  const total = results.length;
  const totalPages = Math.ceil(total / CASES_PAGE_SIZE);
  
  if (casesCurrentPage > totalPages) {
    casesCurrentPage = totalPages;
  }
  if (casesCurrentPage < 1) {
    casesCurrentPage = 1;
  }

  const start = (casesCurrentPage - 1) * CASES_PAGE_SIZE;
  const slice = results.slice(start, start + CASES_PAGE_SIZE);

  // Matches the server's requireRole('ASSOCIATE') floor on PATCH
  // /api/v1/cases/:id/archive — computed once per render rather than per
  // row, since it doesn't vary by case.
  const canArchive = !isParalegal();

  // Render rows
  tbody.innerHTML = slice.map(c => {
    const statusLabels = {
      active: 'Active',
      pending: 'Awaiting Docs',
      urgent: 'Urgent Deadline',
      closed: 'Closed'
    };

    return `
      <tr>
        <td class="case-title-cell">
          <div>${escapeHtml(c.name)}</div>
          <div class="case-id-sub">${escapeHtml(c.id)}</div>
        </td>
        <td class="client-name-cell">${escapeHtml(c.client)}</td>
        <td class="opposing-counsel-cell">
          <div>${escapeHtml(c.opposingParty)}</div>
          <div class="opposing-firm-sub">${escapeHtml(c.opposingCounsel)}</div>
        </td>
        <td>
          <span class="status-badge ${c.status}">${statusLabels[c.status] || c.status}</span>
        </td>
        <td class="activity-time">${escapeHtml(c.nextHearing)}</td>
        <td class="actions-cell-wrap">
          <button class="row-action-btn" aria-label="Actions for ${escapeAttr(c.name)}" data-action="toggle-actions-dropdown" data-key="${escapeAttr(c.id)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
          <div class="actions-dropdown-menu" id="dropdown-${c.id}">
            <button class="actions-dropdown-item" data-action="case-action" data-case-action="open" data-case-id="${escapeAttr(c.id)}" data-case-name="${escapeAttr(c.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
              Open Case File
            </button>
            <button class="actions-dropdown-item" data-action="case-action" data-case-action="upload" data-case-id="${escapeAttr(c.id)}" data-case-name="${escapeAttr(c.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
              Upload to Document Index
            </button>
            <button class="actions-dropdown-item" data-action="case-action" data-case-action="message" data-case-id="${escapeAttr(c.id)}" data-case-name="${escapeAttr(c.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              Message via Client Portal
            </button>
            <button class="actions-dropdown-item" data-action="case-action" data-case-action="intake" data-case-id="${escapeAttr(c.id)}" data-case-name="${escapeAttr(c.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg>
              Matter Intake
            </button>
            ${canArchive ? `
            <div style="height:1px; background:rgba(255,255,255,0.06); margin:4px 0;"></div>
            <button class="actions-dropdown-item danger-item" data-action="case-action" data-case-action="archive" data-case-id="${escapeAttr(c.id)}" data-case-name="${escapeAttr(c.name)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M21 8v13a2 2 0 01-2 2H5a2 2 0 01-2-2V8M22 3H2v5h20V3zM10 12h4"/></svg>
              Archive Case
            </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Update showing text
  const end = Math.min(start + CASES_PAGE_SIZE, total);
  $('casesShowingText').textContent = `Showing ${start + 1}–${end} of ${total}`;

  // Update page controls
  $('casesPrevPage').disabled = casesCurrentPage === 1;
  $('casesNextPage').disabled = casesCurrentPage === totalPages;

  // Render Page Numbers
  let pageNumbersHtml = '';
  for (let i = 1; i <= totalPages; i++) {
    pageNumbersHtml += `
      <button class="page-btn ${casesCurrentPage === i ? 'active' : ''}" data-action="set-cases-page" data-page-number="${i}">${i}</button>
    `;
  }
  $('casesPageNumbers').innerHTML = pageNumbersHtml;
}

function setupCasesPageListeners() {
  if (casesListenersInitialized) return;

  $('casesPageSearch').addEventListener('input', (e) => {
    casesSearchQuery = e.target.value;
    casesCurrentPage = 1;
    renderCasesList();
  });

  $$('#statusFilterPills .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('#statusFilterPills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      casesStatusFilter = pill.dataset.value;
      casesCurrentPage = 1;
      renderCasesList();
    });
  });

  $('practiceAreaSelect').addEventListener('change', (e) => {
    casesAreaFilter = e.target.value;
    casesCurrentPage = 1;
    renderCasesList();
  });

  $('attorneySelect').addEventListener('change', (e) => {
    casesAttorneyFilter = e.target.value;
    casesCurrentPage = 1;
    renderCasesList();
  });

  $('dateRangeSelect').addEventListener('change', (e) => {
    casesDateFilter = e.target.value;
    casesCurrentPage = 1;
    renderCasesList();
  });

  $('casesPrevPage').addEventListener('click', () => {
    if (casesCurrentPage > 1) {
      casesCurrentPage--;
      renderCasesList();
    }
  });

  $('casesNextPage').addEventListener('click', () => {
    const total = countFilteredCases();
    const totalPages = Math.ceil(total / CASES_PAGE_SIZE);
    if (casesCurrentPage < totalPages) {
      casesCurrentPage++;
      renderCasesList();
    }
  });

  const newCaseButtons = ['casesPageNewBtn', 'emptyStateNewBtn'];
  newCaseButtons.forEach(id => {
    const btn = $(id);
    if (btn) {
      btn.addEventListener('click', () => {
        openNewCaseModal();
      });
    }
  });

  if ($('casesPageStartIntakeBtn')) {
    $('casesPageStartIntakeBtn').addEventListener('click', openStartIntakeModal);
  }
  setupMatterIntakeListeners();
  setupCaseDetailListeners();

  $$('.sortable-cases').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (casesSortColumn === col) {
        casesSortDirection = casesSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        casesSortColumn = col;
        casesSortDirection = 'asc';
      }
      
      $$('.sortable-cases svg').forEach(svg => svg.style.transform = '');
      const currentSvg = th.querySelector('svg');
      if (currentSvg && casesSortDirection === 'desc') {
        currentSvg.style.transform = 'rotate(180deg)';
      }
      
      renderCasesList();
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.actions-cell-wrap')) {
      closeAllActionsDropdowns();
    }
  });

  casesListenersInitialized = true;
}

function countFilteredCases() {
  return CASES.filter(c => {
    const q = casesSearchQuery.toLowerCase();
    const matchesSearch = !q || 
      c.id.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.client.toLowerCase().includes(q) ||
      c.opposingParty.toLowerCase().includes(q) ||
      c.opposingCounsel.toLowerCase().includes(q) ||
      c.type.toLowerCase().includes(q);

    const matchesStatus = casesStatusFilter === 'all' || c.status === casesStatusFilter;
    const matchesArea = casesAreaFilter === 'all' || c.type === casesAreaFilter;
    const matchesAttorney = casesAttorneyFilter === 'all' || c.attorney === casesAttorneyFilter;
    
    let matchesDate = true;
    if (casesDateFilter !== 'all') {
      const now = new Date();
      const caseDate = c.createdDate || new Date();
      const diffTime = Math.abs(now - caseDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      matchesDate = diffDays <= parseInt(casesDateFilter, 10);
    }

    return matchesSearch && matchesStatus && matchesArea && matchesAttorney && matchesDate;
  }).length;
}

function setCasesPage(p) {
  casesCurrentPage = p;
  renderCasesList();
}

function openNewCaseModal() {
  const modal = $('newCaseModal');
  if (modal) {
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.add('active'), 10);
  }
}

function closeNewCaseModal() {
  const modal = $('newCaseModal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.classList.add('hidden'), 300);
    $('newCaseForm').reset();
    resetConflictWarningPanel();
  }
}

// Hides the conflict-warning panel and clears its acknowledgment state —
// called on modal close and after a successful create, so a stale warning
// from a previous attempt never carries into the next one.
function resetConflictWarningPanel() {
  const panel = $('conflictWarningPanel');
  if (panel) panel.classList.add('hidden');
  const list = $('conflictWarningList');
  if (list) list.innerHTML = '';
  const ack = $('conflictAckCheckbox');
  if (ack) ack.checked = false;
  const reason = $('conflictOverrideReason');
  if (reason) reason.value = '';
  const submitBtn = $('newCaseSubmitBtn');
  if (submitBtn) submitBtn.textContent = 'Create Case Record';
}

// Renders ConflictCheckService's matches (see CaseService.createCase's 409
// response) into the warning panel. Built with textContent, not innerHTML —
// every value here (case names, party names) is free-text the user or a
// prior case entry supplied, so it must never be interpreted as markup.
function renderConflictWarning(matches) {
  const list = $('conflictWarningList');
  if (!list) return;
  list.innerHTML = '';
  for (const m of matches) {
    const li = document.createElement('li');
    li.textContent = `"${m.newValue}" (${m.newFieldLabel}) matches ${m.existingFieldLabel} "${m.existingValue}" on case ${m.caseId} (${m.caseName})`;
    list.appendChild(li);
  }
  $('conflictWarningPanel').classList.remove('hidden');
  const submitBtn = $('newCaseSubmitBtn');
  if (submitBtn) submitBtn.textContent = 'Create Anyway';
}

async function handleNewCaseSubmit(e) {
  e.preventDefault();

  const title = $('newCaseTitle').value;
  const client = $('newCaseClient').value;
  const opposing = $('newCaseOpposing').value;
  const counsel = $('newCaseCounsel').value;
  const area = $('newCaseArea').value;
  const attorney = $('newCaseAttorney').value; // e.g. "Sarah J." — matched server-side to a real user
  const status = $('newCaseStatus').value;
  const hearing = $('newCaseHearing').value || 'None';
  const relatedEntities = $('newCaseRelatedEntities').value
    .split(',').map(s => s.trim()).filter(Boolean);

  const conflictPanelVisible = !$('conflictWarningPanel').classList.contains('hidden');
  if (conflictPanelVisible) {
    if (!$('conflictAckCheckbox').checked) {
      showToast('Please acknowledge the conflict check results before proceeding.', 'error');
      return;
    }
    if (!$('conflictOverrideReason').value.trim()) {
      showToast('Please provide a reason for proceeding despite the potential conflict.', 'error');
      return;
    }
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating…'; }

  try {
    const { status: httpStatus, json } = await ApiClient.post('/api/v1/cases', {
      title, client, opposingParty: opposing, opposingCounsel: counsel,
      area, attorney, status, hearing, relatedEntities,
      ...(conflictPanelVisible ? {
        conflictOverride: true,
        conflictOverrideReason: $('conflictOverrideReason').value.trim()
      } : {})
    });

    if (httpStatus === 409 && json.conflicts) {
      renderConflictWarning(json.conflicts);
      return;
    }
    if (!json.success) throw new Error(json.error || 'Failed to create case.');

    closeNewCaseModal();
    showToast(`Case ${json.data.id} created successfully.`, 'success');
    await loadCases(); // re-fetch rather than hand-splicing the new row, so every derived field (color, initials, formatted hearing date) matches what a fresh page load would show
  } catch (err) {
    showToast(err.message || 'Failed to create case.', 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = $('conflictWarningPanel').classList.contains('hidden') ? 'Create Case Record' : 'Create Anyway'; }
  }
}

function toggleActionsDropdown(event, caseId) {
  event.stopPropagation();
  const dropdown = document.getElementById(`dropdown-${caseId}`);
  if (!dropdown) return;
  const wasOpen = dropdown.classList.contains('open');
  closeAllActionsDropdowns();
  if (!wasOpen) {
    dropdown.classList.add('open');
  }
}

function closeAllActionsDropdowns() {
  $$('.actions-dropdown-menu').forEach(dd => {
    dd.classList.remove('open');
  });
}

async function handleCaseAction(action, caseId, caseName) {
  closeAllActionsDropdowns();
  if (action === 'open') {
    await openCaseDetailModal(caseId, caseName);
  } else if (action === 'upload') {
    // Reuses the Document Vault's existing upload modal/component
    // (openUploadModal) and its already-case_id-aware backend
    // (VaultService.initiateUpload) — just pre-scopes it to this case
    // instead of opening a new uploader.
    navigateToPage('documents');
    await initDocumentVault(); // ensure vault stats are loaded before the modal reads VaultState.stats for its quota bar
    openUploadModal(caseId);
  } else if (action === 'message') {
    // Reuses the Communications page's existing conversation list +
    // composer (selectConversation) — finds this case's thread by caseId
    // and opens it, rather than building a new composer.
    navigateToPage('communications');
    await loadConversations();
    const conv = CONVERSATIONS.find(cv => cv.caseId === caseId);
    if (conv) {
      await selectConversation(conv.id);
    } else {
      showToast(`No client portal conversation exists yet for ${caseName}.`, 'warning');
    }
  } else if (action === 'intake') {
    await openMatterIntakeModal(caseId, caseName);
  } else if (action === 'archive') {
    const confirmArchive = confirm(`Are you sure you want to archive case: ${caseName}?`);
    if (!confirmArchive) return;

    try {
      await ApiClient.patch(`/api/v1/cases/${caseId}/archive`, {});
      showToast(`Case ${caseId} has been successfully archived.`, 'success');
      await loadCases();
    } catch (err) {
      showToast(err.message || 'Failed to archive case.', 'error');
    }
  }
}

/* ════════════════════════════════════════════
   CASE FILE (DETAIL) MODAL — "Open Case File" row action
   Read-only drill-down for one case: overview, its documents, deadlines,
   and activity feed. Reuses the same GET endpoints the client portal
   already reads (CaseService.getCase/getCaseDocuments/getCaseDeadlines/
   getCaseActivity) — those apply no CLIENT-only restriction to a staff
   caller (scopeCasesToUser only filters for role === 'CLIENT'), so no new
   backend route was needed, just a staff-facing view of the same data.
   ════════════════════════════════════════════ */

const CASE_DETAIL_STATUS_LABEL = { active: 'Active', pending: 'Awaiting Docs', urgent: 'Urgent Deadline', closed: 'Closed' };

async function openCaseDetailModal(caseId, caseName) {
  $('caseDetailCaseLabel').textContent = `${caseName} (${caseId})`;
  $('caseDetailOverview').innerHTML = '<p style="color:var(--slate-400)">Loading…</p>';
  $('caseDetailDocuments').innerHTML = '';
  $('caseDetailDeadlines').innerHTML = '';
  $('caseDetailActivity').innerHTML = '';

  const modal = $('caseDetailModal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);

  try {
    const [caseRow, documents, deadlines, activity] = await Promise.all([
      ApiClient.get(`/api/v1/cases/${caseId}`),
      ApiClient.get(`/api/v1/cases/${caseId}/documents`),
      ApiClient.get(`/api/v1/cases/${caseId}/deadlines`),
      ApiClient.get(`/api/v1/cases/${caseId}/activity`)
    ]);
    renderCaseDetailOverview(caseRow);
    renderCaseDetailDocuments(documents);
    renderCaseDetailDeadlines(deadlines);
    renderCaseDetailActivity(activity);
  } catch (err) {
    $('caseDetailOverview').innerHTML = `<p style="color:#E74C3C">Failed to load case file: ${escapeHtml(err.message)}</p>`;
  }
}

function closeCaseDetailModal() {
  const modal = $('caseDetailModal');
  modal.classList.remove('active');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

function renderCaseDetailOverview(c) {
  $('caseDetailOverview').innerHTML = `
    <div class="form-row-two">
      <div><strong>Client</strong><div>${escapeHtml(c.client)}</div></div>
      <div><strong>Status</strong><div><span class="status-badge ${c.status}">${CASE_DETAIL_STATUS_LABEL[c.status] || c.status}</span></div></div>
    </div>
    <div class="form-row-two" style="margin-top:10px;">
      <div><strong>Opposing Party</strong><div>${escapeHtml(c.opposingParty) || '—'}</div></div>
      <div><strong>Opposing Counsel</strong><div>${escapeHtml(c.opposingCounsel) || '—'}</div></div>
    </div>
    <div class="form-row-two" style="margin-top:10px;">
      <div><strong>Practice Area</strong><div>${escapeHtml(c.type) || '—'}</div></div>
      <div><strong>Lead Attorney</strong><div>${escapeHtml(c.attorney) || 'Unassigned'}</div></div>
    </div>
    <div style="margin-top:10px;"><strong>Next Hearing</strong><div>${escapeHtml(c.nextHearing) || 'None'}</div></div>
    ${c.description ? `<div style="margin-top:10px;"><strong>Description</strong><div>${escapeHtml(c.description)}</div></div>` : ''}
  `;
}

function renderCaseDetailDocuments(docs) {
  const el = $('caseDetailDocuments');
  if (!docs.length) { el.innerHTML = '<p style="color:var(--slate-400)">No documents on file.</p>'; return; }
  el.innerHTML = `
    <table class="cases-large-table">
      <thead><tr><th>File</th><th>Category</th><th>Uploaded By</th><th>Uploaded</th><th></th></tr></thead>
      <tbody>
        ${docs.map(d => `
          <tr>
            <td>${escapeHtml(d.file_name)}</td>
            <td>${escapeHtml(d.category) || '—'}</td>
            <td>${escapeHtml(d.author_name) || '—'}</td>
            <td class="activity-time">${new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}</td>
            <td><button class="btn-ghost" style="padding:2px 8px; font-size:12px;" data-action="open-document-detail" data-document-id="${escapeAttr(d.id)}" data-file-name="${escapeAttr(d.file_name || '')}">Version History</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderCaseDetailDeadlines(items) {
  const el = $('caseDetailDeadlines');
  if (!items.length) { el.innerHTML = '<p style="color:var(--slate-400)">No deadlines on file.</p>'; return; }
  el.innerHTML = items.map(d => `
    <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
      <span>${escapeHtml(d.title)}${d.location ? ' — ' + escapeHtml(d.location) : ''}</span>
      <span class="activity-time">${escapeHtml(d.dateFormatted)}</span>
    </div>
  `).join('');
}

function renderCaseDetailActivity(items) {
  const el = $('caseDetailActivity');
  if (!items.length) { el.innerHTML = '<p style="color:var(--slate-400)">No activity recorded yet.</p>'; return; }
  el.innerHTML = items.map(a => `
    <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
      <span>${escapeHtml(a.label)}${a.actorName ? ' — ' + escapeHtml(a.actorName) : ''}</span>
      <span class="activity-time">${new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}</span>
    </div>
  `).join('');
}

function setupCaseDetailListeners() {
  $('caseDetailModalCloseBtn').addEventListener('click', closeCaseDetailModal);
  $('caseDetailModal').addEventListener('click', (e) => { if (e.target === $('caseDetailModal')) closeCaseDetailModal(); });
}

/* ════════════════════════════════════════════
   MATTER INTAKE (conflict check -> engagement letter -> signed ->
   retainer received -> activated)
   A separate flow from the quick "New Case" modal above — see
   server/services/matterIntakeService.js. Two modals: startIntakeModal
   (creates the case + its intake row together) and matterIntakeModal
   (the checklist/stepper, re-rendered from whatever state the server
   reports rather than tracked as separate client-side flags).
   ════════════════════════════════════════════ */

let intakeCurrentCaseId = null;

// Same PARTNER+ floor as the server's requireRole('PARTNER') on
// conflict-override/retainer-waive/activate (server/routes/api.js) —
// reuses canManageTrust() since it's the identical role set, just named
// for this call site.
function canOverrideIntakeCompliance() {
  return canManageTrust();
}

function setupMatterIntakeListeners() {
  if ($('startIntakeModalCloseBtn')) $('startIntakeModalCloseBtn').addEventListener('click', closeStartIntakeModal);
  if ($('startIntakeModalCancelBtn')) $('startIntakeModalCancelBtn').addEventListener('click', closeStartIntakeModal);
  if ($('startIntakeModal')) $('startIntakeModal').addEventListener('click', (e) => { if (e.target === $('startIntakeModal')) closeStartIntakeModal(); });

  if ($('intakeModalCloseBtn')) $('intakeModalCloseBtn').addEventListener('click', closeMatterIntakeModal);
  if ($('intakeModalCloseBtn2')) $('intakeModalCloseBtn2').addEventListener('click', closeMatterIntakeModal);
  if ($('matterIntakeModal')) $('matterIntakeModal').addEventListener('click', (e) => { if (e.target === $('matterIntakeModal')) closeMatterIntakeModal(); });

  if ($('intakeConflictOverrideBtn')) $('intakeConflictOverrideBtn').addEventListener('click', handleIntakeConflictOverride);
  if ($('intakeLetterUploadBtn')) $('intakeLetterUploadBtn').addEventListener('click', handleIntakeLetterUpload);
  if ($('intakeLetterSentBtn')) $('intakeLetterSentBtn').addEventListener('click', handleIntakeLetterSent);
  if ($('intakeSignedUploadBtn')) $('intakeSignedUploadBtn').addEventListener('click', handleIntakeSignedUpload);
  if ($('intakeRetainerAccount')) $('intakeRetainerAccount').addEventListener('change', loadIntakeRetainerLedgers);
  if ($('intakeRetainerRecordBtn')) $('intakeRetainerRecordBtn').addEventListener('click', handleIntakeRetainerRecord);
  if ($('intakeRetainerWaiveBtn')) $('intakeRetainerWaiveBtn').addEventListener('click', handleIntakeRetainerWaive);
  if ($('intakeActivateBtn')) $('intakeActivateBtn').addEventListener('click', handleIntakeActivate);
  if ($('intakeDeclineBtn')) $('intakeDeclineBtn').addEventListener('click', handleIntakeDecline);
}

// ── Start Matter Intake ───────────────────────────────────────────────────
function openStartIntakeModal() {
  $('startIntakeForm').reset();
  const modal = $('startIntakeModal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);
}

function closeStartIntakeModal() {
  const modal = $('startIntakeModal');
  modal.classList.remove('active');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

async function handleStartIntakeSubmit(e) {
  e.preventDefault();
  const title = $('intakeNewTitle').value.trim();
  const client = $('intakeNewClient').value.trim();
  if (!title || !client) return;

  const relatedEntities = $('intakeNewRelatedEntities').value
    .split(',').map(s => s.trim()).filter(Boolean);

  const submitBtn = $('startIntakeSubmitBtn');
  submitBtn.disabled = true;
  try {
    const { ok, json } = await ApiClient.post('/api/v1/cases/intake', {
      title, client,
      opposingParty: $('intakeNewOpposing').value.trim() || undefined,
      opposingCounsel: $('intakeNewCounsel').value.trim() || undefined,
      area: $('intakeNewArea').value || undefined,
      attorney: $('intakeNewAttorney').value || undefined,
      relatedEntities
    });
    if (!ok) throw new Error(json.error || 'Failed to start matter intake.');
    closeStartIntakeModal();
    showToast(`Matter intake started for ${json.data.case_id}.`, 'success');
    await loadCases();
    await openMatterIntakeModal(json.data.case_id, title);
  } catch (err) {
    showToast(err.message || 'Failed to start matter intake.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

// ── Matter Intake Checklist ───────────────────────────────────────────────
const INTAKE_STATE_LABEL = {
  CONFLICT_PENDING: 'Conflict check pending',
  CONFLICT_HOLD: 'On hold — potential conflict of interest',
  CONFLICT_CLEARED: 'Conflict cleared',
  ENGAGEMENT_LETTER_DRAFTED: 'Engagement letter drafted',
  ENGAGEMENT_LETTER_SENT: 'Engagement letter sent to client',
  SIGNED: 'Engagement letter signed',
  RETAINER_RECEIVED: 'Retainer settled',
  ACTIVATED: 'Matter activated',
  DECLINED: 'Matter declined'
};

async function openMatterIntakeModal(caseId, caseName) {
  intakeCurrentCaseId = caseId;
  $('intakeCaseLabel').textContent = `${caseName} (${caseId})`;

  const modal = $('matterIntakeModal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);

  await refreshMatterIntake();
}

function closeMatterIntakeModal() {
  const modal = $('matterIntakeModal');
  modal.classList.remove('active');
  setTimeout(() => modal.classList.add('hidden'), 300);
  intakeCurrentCaseId = null;
}

async function refreshMatterIntake() {
  if (!intakeCurrentCaseId) return;
  try {
    const intake = await ApiClient.get(`/api/v1/cases/${intakeCurrentCaseId}/intake`);
    renderMatterIntake(intake);
  } catch (err) {
    // A case with no case_intake row (created via the plain "New Case"
    // flow, or any case that predates this workflow) 404s here — that's
    // not an error, it just means this case was never opened through
    // Matter Intake.
    closeMatterIntakeModal();
    showToast('This case was not opened through the Matter Intake workflow.', 'info');
  }
}

function renderMatterIntake(intake) {
  const s = intake.state;
  const c = intake.checklist;

  const banner = $('intakeStateBanner');
  banner.textContent = INTAKE_STATE_LABEL[s] || s;
  banner.style.color = (s === 'CONFLICT_HOLD' || s === 'DECLINED') ? '#E74C3C' : (s === 'ACTIVATED' ? '#2DC8B0' : 'inherit');

  const canOverride = canOverrideIntakeCompliance();

  // 1. Conflict
  if (s === 'CONFLICT_HOLD') {
    const matches = intake.conflict_check_matches || [];
    // escapeHtml on every field, not just a manual `<`-only replace on two
    // of them — found during a security-review follow-up sweep: the old
    // partial escape left newFieldLabel/existingFieldLabel/caseName
    // completely unescaped, and even the two fields it did touch only
    // handled `<`, not `&`/`>`/quotes.
    $('intakeConflictSummary').innerHTML = `<strong style="color:#E74C3C">${matches.length} potential conflict${matches.length === 1 ? '' : 's'} found:</strong><br>` +
      matches.map(m => `${escapeHtml(m.newValue)} (${escapeHtml(m.newFieldLabel)}) matches "${escapeHtml(m.existingValue)}" (${escapeHtml(m.existingFieldLabel)}) on case ${escapeHtml(m.caseName)}`).join('<br>');
    $('intakeConflictOverrideSection').classList.toggle('hidden', !canOverride);
    if (!canOverride) {
      $('intakeConflictSummary').innerHTML += '<br><em style="color:var(--slate-400)">Only a Partner can override a conflict hold.</em>';
    }
  } else {
    $('intakeConflictSummary').textContent = '✓ Cleared';
    $('intakeConflictOverrideSection').classList.add('hidden');
  }

  // 2. Engagement letter
  $('intakeLetterUploadSection').classList.toggle('hidden', s !== 'CONFLICT_CLEARED');
  $('intakeLetterSentSection').classList.toggle('hidden', s !== 'ENGAGEMENT_LETTER_DRAFTED');
  if (c.engagement_letter_sent) {
    $('intakeLetterSummary').textContent = '✓ Drafted and sent to client';
  } else if (c.engagement_letter_drafted) {
    $('intakeLetterSummary').textContent = 'Drafted — not yet marked sent';
  } else {
    $('intakeLetterSummary').textContent = 'Awaiting upload';
  }

  // 3. Signed
  $('intakeSignedUploadSection').classList.toggle('hidden', s !== 'ENGAGEMENT_LETTER_SENT');
  $('intakeSignedSummary').textContent = c.signed ? '✓ Countersigned copy on file' : 'Awaiting signature';

  // 4. Retainer
  $('intakeRetainerFormSection').classList.toggle('hidden', s !== 'SIGNED');
  if (s === 'SIGNED' && !$('intakeRetainerAccount').dataset.loaded) loadIntakeRetainerAccounts();
  if (c.retainer_settled) {
    $('intakeRetainerSummary').textContent = intake.retainer_waived
      ? `Waived — ${intake.retainer_waived_reason || ''}`
      : '✓ Retainer received';
  } else {
    $('intakeRetainerSummary').textContent = 'Awaiting retainer deposit or waiver';
  }
  if (s === 'SIGNED' && !canOverride) {
    $('intakeRetainerWaiveBtn').classList.add('hidden');
  } else if ($('intakeRetainerWaiveBtn')) {
    $('intakeRetainerWaiveBtn').classList.remove('hidden');
  }

  // 5. Activate
  $('intakeActivateBtn').classList.toggle('hidden', s !== 'RETAINER_RECEIVED' || !canOverride);
  if (s === 'ACTIVATED') {
    $('intakeActivateSummary').textContent = `✓ Activated ${intake.activated_at ? formatInvoiceDate(intake.activated_at.slice(0, 10)) : ''}`;
  } else if (s === 'RETAINER_RECEIVED' && !canOverride) {
    $('intakeActivateSummary').textContent = 'Ready to activate — requires a Partner.';
  } else if (s === 'RETAINER_RECEIVED') {
    $('intakeActivateSummary').textContent = 'All steps complete — ready to activate.';
  } else {
    $('intakeActivateSummary').textContent = 'Complete the steps above first.';
  }

  $('intakeDeclineBtn').classList.toggle('hidden', s === 'ACTIVATED' || s === 'DECLINED');
}

async function handleIntakeConflictOverride() {
  const reason = $('intakeConflictOverrideReason').value.trim();
  if (!reason) return showToast('An override reason is required.', 'error');
  try {
    await ApiClient.post(`/api/v1/cases/${intakeCurrentCaseId}/intake/conflict-override`, { reason });
    showToast('Conflict hold overridden.', 'success');
    await refreshMatterIntake();
  } catch (err) {
    showToast(err.message || 'Failed to override conflict hold.', 'error');
  }
}

async function handleIntakeLetterUpload() {
  const fileInput = $('intakeLetterFile');
  const file = fileInput.files[0];
  if (!file) return showToast('Choose a file to upload.', 'error');

  const formData = new FormData();
  formData.append('file', file);
  try {
    const { ok, json } = await ApiClient.postForm(`/api/v1/cases/${intakeCurrentCaseId}/intake/engagement-letter`, formData);
    if (!ok) throw new Error(json.error || 'Failed to upload engagement letter.');
    showToast('Engagement letter uploaded.', 'success');
    fileInput.value = '';
    await refreshMatterIntake();
  } catch (err) {
    showToast(err.message || 'Failed to upload engagement letter.', 'error');
  }
}

async function handleIntakeLetterSent() {
  try {
    await ApiClient.post(`/api/v1/cases/${intakeCurrentCaseId}/intake/engagement-letter/sent`, {});
    showToast('Marked as sent to client.', 'success');
    await refreshMatterIntake();
  } catch (err) {
    showToast(err.message || 'Failed to update.', 'error');
  }
}

async function handleIntakeSignedUpload() {
  const fileInput = $('intakeSignedFile');
  const file = fileInput.files[0];
  if (!file) return showToast('Choose a file to upload.', 'error');

  const formData = new FormData();
  formData.append('file', file);
  try {
    const { ok, json } = await ApiClient.postForm(`/api/v1/cases/${intakeCurrentCaseId}/intake/signed`, formData);
    if (!ok) throw new Error(json.error || 'Failed to upload signed copy.');
    showToast('Signed copy uploaded.', 'success');
    fileInput.value = '';
    await refreshMatterIntake();
  } catch (err) {
    showToast(err.message || 'Failed to upload signed copy.', 'error');
  }
}

async function loadIntakeRetainerAccounts() {
  const select = $('intakeRetainerAccount');
  select.dataset.loaded = '1';
  try {
    const accounts = await ApiClient.get('/api/v1/trust/accounts');
    select.innerHTML = accounts.map(a => `<option value="${escapeAttr(a.id)}">${escapeHtml(a.account_name)}</option>`).join('') || '<option value="">No trust accounts configured</option>';
    await loadIntakeRetainerLedgers();
  } catch (err) {
    select.innerHTML = '<option value="">Error loading trust accounts</option>';
  }
}

async function loadIntakeRetainerLedgers() {
  const accountId = $('intakeRetainerAccount').value;
  const ledgerSelect = $('intakeRetainerLedger');
  if (!accountId) { ledgerSelect.innerHTML = ''; return; }
  ledgerSelect.innerHTML = '<option value="">Loading…</option>';
  try {
    const ledgers = await ApiClient.get(`/api/v1/trust/client-ledgers?trust_account_id=${accountId}`);
    ledgerSelect.innerHTML = ledgers.length
      ? ledgers.map(l => `<option value="${escapeAttr(l.id)}">${escapeHtml(l.client_display_name)} (${formatMoney(l.balance_cents)})</option>`).join('')
      : '<option value="">No client ledgers — open one on the Trust Accounting page first</option>';
  } catch (err) {
    ledgerSelect.innerHTML = '<option value="">Error loading client ledgers</option>';
  }
}

async function handleIntakeRetainerRecord() {
  const ledgerId = $('intakeRetainerLedger').value;
  const amountDollars = parseFloat($('intakeRetainerAmount').value);
  const memo = $('intakeRetainerMemo').value.trim() || 'Initial retainer';
  if (!ledgerId) return showToast('Select a client ledger.', 'error');
  if (!amountDollars || amountDollars <= 0) return showToast('Enter a valid, positive amount.', 'error');

  try {
    const { ok, json } = await ApiClient.post(`/api/v1/cases/${intakeCurrentCaseId}/intake/retainer`, {
      client_ledger_id: ledgerId, amount_cents: Math.round(amountDollars * 100), memo
    });
    if (!ok) throw new Error(json.error || 'Failed to record retainer.');
    showToast('Retainer recorded.', 'success');
    await refreshMatterIntake();
  } catch (err) {
    showToast(err.message || 'Failed to record retainer.', 'error');
  }
}

async function handleIntakeRetainerWaive() {
  const reason = $('intakeRetainerWaiveReason').value.trim();
  if (!reason) return showToast('A reason is required to waive the retainer.', 'error');
  try {
    await ApiClient.post(`/api/v1/cases/${intakeCurrentCaseId}/intake/retainer/waive`, { reason });
    showToast('Retainer waived.', 'success');
    await refreshMatterIntake();
  } catch (err) {
    showToast(err.message || 'Failed to waive retainer.', 'error');
  }
}

async function handleIntakeActivate() {
  const confirmed = confirm('Activate this matter? This makes it a normal active case, visible everywhere an active case is.');
  if (!confirmed) return;
  try {
    await ApiClient.post(`/api/v1/cases/${intakeCurrentCaseId}/intake/activate`, {});
    showToast('Matter activated.', 'success');
    await refreshMatterIntake();
    await loadCases();
  } catch (err) {
    showToast(err.message || 'Failed to activate matter.', 'error');
  }
}

async function handleIntakeDecline() {
  const reason = prompt('Reason for declining this matter (required):');
  if (!reason || !reason.trim()) return;
  try {
    await ApiClient.post(`/api/v1/cases/${intakeCurrentCaseId}/intake/decline`, { reason: reason.trim() });
    showToast('Matter declined.', 'info');
    closeMatterIntakeModal();
    await loadCases();
  } catch (err) {
    showToast(err.message || 'Failed to decline matter.', 'error');
  }
}

/* ════════════════════════════════════════════
   BILLING PAGE (INVOICES)
   Same list/filter/modal/row-action-dropdown pattern as the Active Cases
   page above: re-fetches on every visit (initBillingPage, matching
   initCasesPage/initDocumentVault), filters/paginates client-side over
   the full INVOICES array, and reuses the same modal/dropdown/status-badge
   CSS classes rather than introducing new ones.
   ════════════════════════════════════════════ */

let billingSearchQuery = "";
let billingStatusFilter = "all";
let billingCurrentPage = 1;
const BILLING_PAGE_SIZE = 8;
let billingListenersInitialized = false;
let currentInvoiceEditId = null;

let billingActiveTab = 'invoices';

function initBillingPage() {
  const allowed = canManageBilling();
  if ($('billingPageNewBtn')) $('billingPageNewBtn').classList.toggle('hidden', !allowed);
  if ($('billingEmptyStateNewBtn')) $('billingEmptyStateNewBtn').classList.toggle('hidden', !allowed);
  // billingPageNewBtn's visibility is also toggled per-tab below (only
  // shown on the Invoices tab) — Log Time has no such gate (any staff role
  // may log their own time), so timeEntryNewBtn stays visible unconditionally.

  setupBillingPageListeners();
  setBillingTab(billingActiveTab);
  loadInvoices();
}

function setBillingTab(tab) {
  billingActiveTab = tab;
  $$('#billingPage [data-billing-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.billingTab === tab);
  });
  $('billingInvoicesTab').classList.toggle('hidden', tab !== 'invoices');
  $('billingTimeTab').classList.toggle('hidden', tab !== 'time');

  const showNewInvoiceBtn = tab === 'invoices' && canManageBilling();
  if ($('billingPageNewBtn')) $('billingPageNewBtn').classList.toggle('hidden', !showNewInvoiceBtn);
  if ($('timeEntryNewBtn')) $('timeEntryNewBtn').classList.toggle('hidden', tab !== 'time');

  if (tab === 'time' && !timeEntriesLoadedOnce) {
    initTimeEntriesTab();
  }
}

async function loadInvoices() {
  try {
    INVOICES = await ApiClient.get('/api/v1/invoices');
    billingCurrentPage = 1;
    renderBillingList();
  } catch (err) {
    console.error('Invoices load error', err);
    const tbody = $('billingLargeTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--slate-400)">Error loading invoices</td></tr>`;
  }
}

function filteredInvoices() {
  const q = billingSearchQuery.toLowerCase();
  return INVOICES.filter(inv => {
    const matchesSearch = !q ||
      inv.invoice_number.toLowerCase().includes(q) ||
      (inv.case_name || '').toLowerCase().includes(q) ||
      (inv.case_id || '').toLowerCase().includes(q);
    const matchesStatus = billingStatusFilter === 'all' || inv.status === billingStatusFilter;
    return matchesSearch && matchesStatus;
  });
}

// A raw DATE column ('YYYY-MM-DD' or null — see parseDateOnly's own
// comment above) formatted for display; null shows as an em dash rather
// than "Invalid Date" (due_date/paid_date are both nullable).
function formatInvoiceDate(dateStr) {
  if (!dateStr) return '—';
  return parseDateOnly(dateStr).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

// Same badge classes the Active Cases table already uses (active/pending/
// review/urgent/closed) rather than adding new CSS for invoice-specific
// colors — chosen by closest semantic match: paid≈active (green),
// sent≈review (blue, awaiting action), draft≈pending (amber, not yet
// sent), overdue≈urgent (red), void≈closed (gray, inactive).
const INVOICE_STATUS_BADGE_CLASS = { draft: 'pending', sent: 'review', paid: 'active', overdue: 'urgent', void: 'closed' };
const INVOICE_STATUS_LABEL = { draft: 'Draft', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', void: 'Void' };

function renderBillingList() {
  const tbody = $('billingLargeTableBody');
  const emptyState = $('billingEmptyState');
  const table = $('billingLargeTable');
  if (!tbody) return;

  const results = filteredInvoices();

  if (results.length === 0) {
    emptyState.classList.remove('hidden');
    table.classList.add('hidden');
    $('billingShowingText').textContent = 'No invoices found';
    $('billingPrevPage').disabled = true;
    $('billingNextPage').disabled = true;
    $('billingPageNumbers').innerHTML = '';
    return;
  } else {
    emptyState.classList.add('hidden');
    table.classList.remove('hidden');
  }

  const total = results.length;
  const totalPages = Math.ceil(total / BILLING_PAGE_SIZE);
  if (billingCurrentPage > totalPages) billingCurrentPage = totalPages;
  if (billingCurrentPage < 1) billingCurrentPage = 1;

  const start = (billingCurrentPage - 1) * BILLING_PAGE_SIZE;
  const slice = results.slice(start, start + BILLING_PAGE_SIZE);

  // Matches the server's requireRole floors: ASSOCIATE+ for create/edit
  // (requireRole('ASSOCIATE') on POST/PATCH /api/v1/invoices), PARTNER+
  // for Mark Paid (requireRole('PARTNER') on the mark-paid route). A paid
  // invoice is never offered for edit — see the "Edit Invoice" action
  // below — so openInvoiceModal never has to reconcile a 'paid' status
  // against the edit form's status options, which deliberately exclude it.
  const canEdit = canManageBilling();
  const canMarkPaid = canMarkInvoicesPaid();

  tbody.innerHTML = slice.map(inv => {
    const actions = [];
    if (canEdit && inv.status !== 'paid') {
      actions.push(`
        <button class="actions-dropdown-item" data-action="open-invoice-modal" data-invoice-id="${escapeAttr(inv.id)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit Invoice
        </button>
      `);
    }
    if (canMarkPaid && inv.status !== 'paid' && inv.status !== 'void') {
      actions.push(`
        <button class="actions-dropdown-item" data-action="invoice-mark-paid" data-invoice-id="${escapeAttr(inv.id)}" data-invoice-number="${escapeAttr(inv.invoice_number)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M20 6L9 17l-5-5"/></svg>
          Mark Paid
        </button>
      `);
    }

    const actionsHtml = !actions.length ? '' : `
      <button class="row-action-btn" aria-label="Actions for ${inv.invoice_number}" data-action="toggle-actions-dropdown" data-key="inv-${escapeAttr(inv.id)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
        </svg>
      </button>
      <div class="actions-dropdown-menu" id="dropdown-inv-${inv.id}">
        ${actions.join('')}
      </div>
    `;

    return `
      <tr>
        <td>${inv.invoice_number}</td>
        <td>${inv.case_name || '—'}</td>
        <td>${formatMoney(inv.amount_cents)}</td>
        <td><span class="status-badge ${INVOICE_STATUS_BADGE_CLASS[inv.status] || 'closed'}">${INVOICE_STATUS_LABEL[inv.status] || inv.status}</span></td>
        <td class="activity-time">${formatInvoiceDate(inv.issued_date)}</td>
        <td class="activity-time">${formatInvoiceDate(inv.due_date)}</td>
        <td class="activity-time">${formatInvoiceDate(inv.paid_date)}</td>
        <td class="actions-cell-wrap">${actionsHtml}</td>
      </tr>
    `;
  }).join('');

  const end = Math.min(start + BILLING_PAGE_SIZE, total);
  $('billingShowingText').textContent = `Showing ${start + 1}–${end} of ${total}`;
  $('billingPrevPage').disabled = billingCurrentPage === 1;
  $('billingNextPage').disabled = billingCurrentPage === totalPages;

  let pageNumbersHtml = '';
  for (let i = 1; i <= totalPages; i++) {
    pageNumbersHtml += `<button class="page-btn ${billingCurrentPage === i ? 'active' : ''}" data-action="set-billing-page" data-page-number="${i}">${i}</button>`;
  }
  $('billingPageNumbers').innerHTML = pageNumbersHtml;
}

function setBillingPage(p) {
  billingCurrentPage = p;
  renderBillingList();
}

function setupBillingPageListeners() {
  if (billingListenersInitialized) return;

  $('billingPageSearch').addEventListener('input', (e) => {
    billingSearchQuery = e.target.value;
    billingCurrentPage = 1;
    renderBillingList();
  });

  $$('#billingStatusFilterPills .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('#billingStatusFilterPills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      billingStatusFilter = pill.dataset.value;
      billingCurrentPage = 1;
      renderBillingList();
    });
  });

  $('billingPrevPage').addEventListener('click', () => {
    if (billingCurrentPage > 1) {
      billingCurrentPage--;
      renderBillingList();
    }
  });

  $('billingNextPage').addEventListener('click', () => {
    const totalPages = Math.ceil(filteredInvoices().length / BILLING_PAGE_SIZE);
    if (billingCurrentPage < totalPages) {
      billingCurrentPage++;
      renderBillingList();
    }
  });

  ['billingPageNewBtn', 'billingEmptyStateNewBtn'].forEach(id => {
    const btn = $(id);
    if (btn) btn.addEventListener('click', () => openInvoiceModal(null));
  });

  $$('#billingPage [data-billing-tab]').forEach(btn => {
    btn.addEventListener('click', () => setBillingTab(btn.dataset.billingTab));
  });

  $('invoiceModalCloseBtn').addEventListener('click', closeInvoiceModal);
  $('invoiceModalCancelBtn').addEventListener('click', closeInvoiceModal);
  $('invoiceModal').addEventListener('click', (e) => {
    if (e.target === $('invoiceModal')) closeInvoiceModal();
  });

  // Same outside-click-closes-dropdown behavior setupCasesPageListeners
  // registers for the Cases table — registered again here (harmlessly
  // redundant if both pages were visited) so it also works for a session
  // that opens Billing without ever having visited Cases first.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.actions-cell-wrap')) {
      closeAllActionsDropdowns();
    }
  });

  billingListenersInitialized = true;
}

// `invoiceId` is null for "New Invoice" (create mode) or a real invoice id
// for "Edit Invoice" (row action). A paid invoice is never passed here —
// see renderBillingList, which only offers the Edit action for non-paid
// invoices — so the status <select>'s options (which deliberately exclude
// 'paid', matching updateInvoice's server-side rejection of that value)
// never need to represent one.
async function openInvoiceModal(invoiceId) {
  closeAllActionsDropdowns();
  const invoice = invoiceId ? INVOICES.find(i => i.id === invoiceId) : null;
  currentInvoiceEditId = invoice ? invoice.id : null;

  // Rebuilt fresh each open — CASES may have changed since the modal was
  // last shown (a case created after page load, etc).
  const caseSelect = $('invoiceCase');
  caseSelect.innerHTML = '<option value="">No linked case</option>' +
    CASES.map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.id)} — ${escapeHtml(c.name)}</option>`).join('');

  $('invoiceLineItemsSection').classList.add('hidden');
  $('invoiceLineItemsList').innerHTML = '';
  $('invoiceAmount').disabled = false;

  if (invoice) {
    $('invoiceModalTitle').textContent = 'Edit Invoice';
    $('invoiceSubmitBtn').textContent = 'Save Changes';
    caseSelect.value = invoice.case_id || '';
    $('invoiceAmount').value = (invoice.amount_cents / 100).toFixed(2);
    $('invoiceStatus').value = invoice.status;
    $('invoiceDueDate').value = invoice.due_date || '';
    // issued_date isn't editable after creation (see InvoiceService.updateInvoice)
    $('invoiceIssuedDateGroup').classList.add('hidden');

    // An invoice generated from time entries has real line items and a
    // server-enforced amount (InvoiceService.updateInvoice refuses to
    // change amount_cents once line items exist — see
    // AMOUNT_DERIVED_FROM_LINE_ITEMS). Reflect that in the UI instead of
    // letting someone edit a field the server will just reject.
    try {
      const lineItems = await ApiClient.get(`/api/v1/invoices/${invoice.id}/line-items`);
      if (lineItems.length) {
        $('invoiceAmount').disabled = true;
        $('invoiceLineItemsSection').classList.remove('hidden');
        $('invoiceLineItemsList').innerHTML = lineItems.map(li => `
          <div style="display:flex; justify-content:space-between; gap:12px; padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.06); font-size:12px;">
            <span style="color:var(--slate-300);">${escapeHtml(li.description)}</span>
            <span style="color:var(--slate-400); white-space:nowrap;">${(li.quantity_minutes / 60).toFixed(1)}h × ${formatMoney(li.rate_cents)}/h = <strong style="color:#fff;">${formatMoney(li.amount_cents)}</strong></span>
          </div>
        `).join('');
      }
    } catch (err) {
      console.error('Could not load invoice line items', err);
    }
  } else {
    $('invoiceForm').reset();
    $('invoiceModalTitle').textContent = 'New Invoice';
    $('invoiceSubmitBtn').textContent = 'Create Invoice';
    caseSelect.value = '';
    $('invoiceStatus').value = 'draft';
    $('invoiceIssuedDateGroup').classList.remove('hidden');
  }

  const modal = $('invoiceModal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);
}

function closeInvoiceModal() {
  const modal = $('invoiceModal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.classList.add('hidden'), 300);
    $('invoiceForm').reset();
    currentInvoiceEditId = null;
  }
}

async function handleInvoiceSubmit(e) {
  e.preventDefault();

  const caseId = $('invoiceCase').value || null;
  const amountDollars = parseFloat($('invoiceAmount').value);
  const status = $('invoiceStatus').value;
  const dueDate = $('invoiceDueDate').value || null;
  const issuedDate = $('invoiceIssuedDate').value || null;

  if (!Number.isFinite(amountDollars) || amountDollars < 0) {
    showToast('Enter a valid, non-negative amount.', 'error');
    return;
  }
  // Cents on the wire, same as the API — see amount_cents's own comment
  // in db/migrations/0001_cases_invoices_conversations.sql.
  const amountCents = Math.round(amountDollars * 100);

  const isEdit = !!currentInvoiceEditId;
  const submitBtn = $('invoiceSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = isEdit ? 'Saving…' : 'Creating…';

  try {
    if (isEdit) {
      const patchBody = { case_id: caseId, status, due_date: dueDate };
      // The Amount field is disabled (see openInvoiceModal) for an invoice
      // generated from time entries — its amount is derived from real
      // line items, and the server refuses AMOUNT_DERIVED_FROM_LINE_ITEMS
      // if amount_cents is present at all on the PATCH, even unchanged. So
      // this key is simply left off rather than sent and rejected.
      if (!$('invoiceAmount').disabled) patchBody.amount_cents = amountCents;

      await ApiClient.patch(`/api/v1/invoices/${currentInvoiceEditId}`, patchBody);
      showToast('Invoice updated successfully.', 'success');
    } else {
      const { ok, json } = await ApiClient.post('/api/v1/invoices', {
        case_id: caseId, amount_cents: amountCents, status, issued_date: issuedDate, due_date: dueDate
      });
      if (!ok) throw new Error(json.error || 'Failed to create invoice.');
      showToast(`Invoice ${json.data.invoice_number} created successfully.`, 'success');
    }

    closeInvoiceModal();
    await loadInvoices();
  } catch (err) {
    showToast(err.message || 'Failed to save invoice.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = isEdit ? 'Save Changes' : 'Create Invoice';
  }
}

async function handleInvoiceMarkPaid(invoiceId, invoiceNumber) {
  closeAllActionsDropdowns();
  const confirmed = confirm(`Mark invoice ${invoiceNumber} as paid? This records today's date as the payment date.`);
  if (!confirmed) return;

  try {
    await ApiClient.patch(`/api/v1/invoices/${invoiceId}/mark-paid`, {});
    showToast(`Invoice ${invoiceNumber} marked as paid.`, 'success');
    await loadInvoices();
  } catch (err) {
    showToast(err.message || 'Failed to mark invoice as paid.', 'error');
  }
}

/* ════════════════════════════════════════════
   TIME TRACKING (TIME ENTRIES TAB)
   Backs POST/GET/PATCH/DELETE /api/v1/time-entries and
   POST /api/v1/invoices/from-time-entries — see
   server/services/timeEntryService.js for the ownership/immutability
   rules this UI reflects (a PARALEGAL manages only their own entries; an
   ASSOCIATE+ sees and may correct anyone's unbilled entry; an invoiced
   entry can no longer be edited or deleted).
   ════════════════════════════════════════════ */

let TIME_ENTRIES = [];
let timeEntriesLoadedOnce = false;
let timeEntrySearchQuery = '';
let timeEntryStatusFilter = 'all';
// 'mine' vs 'firm' — only meaningful for ASSOCIATE+ (a PARALEGAL's list is
// always their own regardless of this value; the toggle itself is hidden
// for them). Mirrors TimeEntryService.listTimeEntries's own scoping: the
// server enforces "own entries only" for a PARALEGAL unconditionally, this
// is purely a client-side convenience for staff who CAN see everyone's.
let timeEntryScopeFilter = 'mine';
let timeEntryListenersInitialized = false;
let currentTimeEntryEditId = null;
const selectedTimeEntryIds = new Set();

function initTimeEntriesTab() {
  timeEntriesLoadedOnce = true;
  // A PARALEGAL has no firm-wide view — hide the toggle rather than show
  // one option that would always behave like the other.
  $('timeEntryScopeFilterGroup').classList.toggle('hidden', isParalegal());
  setupTimeEntryListeners();
  loadTimeEntries();
}

async function loadTimeEntries() {
  try {
    const params = new URLSearchParams();
    if (!isParalegal() && timeEntryScopeFilter === 'mine') {
      params.set('user_id', Auth.getUser().id);
    }
    const qs = params.toString();
    TIME_ENTRIES = await ApiClient.get(`/api/v1/time-entries${qs ? '?' + qs : ''}`);
    selectedTimeEntryIds.clear();
    renderTimeEntryTable();
  } catch (err) {
    console.error('Time entries load error', err);
    const tbody = $('timeEntryTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--slate-400)">Error loading time entries</td></tr>`;
  }
}

function filteredTimeEntries() {
  const q = timeEntrySearchQuery.toLowerCase();
  return TIME_ENTRIES.filter(t => {
    const matchesSearch = !q ||
      (t.case_name || '').toLowerCase().includes(q) ||
      (t.case_id || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q);
    const matchesStatus = timeEntryStatusFilter === 'all' || t.status === timeEntryStatusFilter;
    return matchesSearch && matchesStatus;
  });
}

const TIME_ENTRY_STATUS_BADGE_CLASS = { unbilled: 'pending', invoiced: 'active', written_off: 'closed' };
const TIME_ENTRY_STATUS_LABEL = { unbilled: 'Unbilled', invoiced: 'Invoiced', written_off: 'Written Off' };

function formatHours(minutes) {
  return (minutes / 60).toFixed(1) + 'h';
}

function renderTimeEntryTable() {
  const tbody = $('timeEntryTableBody');
  const emptyState = $('timeEntryEmptyState');
  const table = $('timeEntryTable');
  if (!tbody) return;

  const results = filteredTimeEntries();

  if (results.length === 0) {
    emptyState.classList.remove('hidden');
    table.classList.add('hidden');
    updateTimeEntryBulkBar();
    return;
  } else {
    emptyState.classList.add('hidden');
    table.classList.remove('hidden');
  }

  const currentUserId = Auth.getUser() && Auth.getUser().id;
  const supervisor = canManageBilling(); // ASSOCIATE+ — see its own comment above

  tbody.innerHTML = results.map(t => {
    const isOwn = t.user_id === currentUserId;
    const canEditOrDelete = t.status === 'unbilled' && (isOwn || supervisor);
    const selectable = t.status === 'unbilled' && t.billable;

    const actions = [];
    if (canEditOrDelete) {
      actions.push(`
        <button class="actions-dropdown-item" data-action="open-time-entry-modal" data-entry-id="${escapeAttr(t.id)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Edit
        </button>
        <button class="actions-dropdown-item danger-item" data-action="delete-time-entry" data-entry-id="${escapeAttr(t.id)}" data-entry-description="${escapeAttr(t.description)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
          Delete
        </button>
      `);
    }
    const actionsHtml = !actions.length ? '' : `
      <button class="row-action-btn" aria-label="Actions for entry" data-action="toggle-actions-dropdown" data-key="te-${escapeAttr(t.id)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
        </svg>
      </button>
      <div class="actions-dropdown-menu" id="dropdown-te-${t.id}">${actions.join('')}</div>
    `;

    return `
      <tr>
        <td>${selectable ? `<input type="checkbox" class="time-entry-checkbox" data-entry-id="${escapeAttr(t.id)}" data-case-id="${escapeAttr(t.case_id)}" ${selectedTimeEntryIds.has(t.id) ? 'checked' : ''} />` : ''}</td>
        <td class="activity-time">${formatInvoiceDate(t.entry_date)}</td>
        <td>${escapeHtml(t.case_name || t.case_id)}</td>
        <td>${escapeHtml(t.user_full_name)}${!t.billable ? ' <span style="color:var(--slate-400);font-size:11px;">(non-billable)</span>' : ''}</td>
        <td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeAttr(t.description)}">${escapeHtml(t.description)}</td>
        <td>${formatHours(t.minutes)}</td>
        <td>${formatMoney(t.rate_cents)}/h</td>
        <td>${formatMoney(t.amount_cents)}</td>
        <td><span class="status-badge ${TIME_ENTRY_STATUS_BADGE_CLASS[t.status] || 'closed'}">${TIME_ENTRY_STATUS_LABEL[t.status] || t.status}</span></td>
        <td class="actions-cell-wrap">${actionsHtml}</td>
      </tr>
    `;
  }).join('');

  // Selection is re-attached fresh each render (checkbox change is
  // delegated for the row-level boxes below, but "select all" needs a
  // direct listener since it isn't a per-row data-action).
  updateTimeEntryBulkBar();
}

function setupTimeEntryListeners() {
  if (timeEntryListenersInitialized) return;

  $('timeEntrySearch').addEventListener('input', (e) => {
    timeEntrySearchQuery = e.target.value;
    renderTimeEntryTable();
  });

  $$('#timeEntryStatusFilterPills .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('#timeEntryStatusFilterPills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      timeEntryStatusFilter = pill.dataset.value;
      renderTimeEntryTable();
    });
  });

  $$('#timeEntryScopeFilterPills .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('#timeEntryScopeFilterPills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      timeEntryScopeFilter = pill.dataset.value;
      loadTimeEntries();
    });
  });

  $('timeEntryNewBtn').addEventListener('click', () => openTimeEntryModal(null));
  $('timeEntryModalCloseBtn').addEventListener('click', closeTimeEntryModal);
  $('timeEntryModalCancelBtn').addEventListener('click', closeTimeEntryModal);
  $('timeEntryModal').addEventListener('click', (e) => {
    if (e.target === $('timeEntryModal')) closeTimeEntryModal();
  });

  $('timeEntrySelectAll').addEventListener('change', (e) => {
    const boxes = $$('#timeEntryTableBody .time-entry-checkbox');
    boxes.forEach(box => {
      box.checked = e.target.checked;
      if (e.target.checked) selectedTimeEntryIds.add(box.dataset.entryId);
      else selectedTimeEntryIds.delete(box.dataset.entryId);
    });
    updateTimeEntryBulkBar();
  });

  // Per-row checkboxes are re-rendered on every table draw, so this is
  // delegated at the tbody level rather than bound per-checkbox.
  $('timeEntryTableBody').addEventListener('change', (e) => {
    if (!e.target.classList.contains('time-entry-checkbox')) return;
    if (e.target.checked) selectedTimeEntryIds.add(e.target.dataset.entryId);
    else selectedTimeEntryIds.delete(e.target.dataset.entryId);
    updateTimeEntryBulkBar();
  });

  timeEntryListenersInitialized = true;
}

// Shows/hides the "Generate Invoice" bulk bar, and the mixed-case warning
// when the current selection spans more than one case — generateInvoice
// only accepts entries from a single case (TimeEntryService.
// generateInvoiceFromTimeEntries's CASE_MISMATCH rule), so this is caught
// and explained before the user ever submits, not just left to the
// server's refusal.
function updateTimeEntryBulkBar() {
  const bar = $('timeEntryBulkBar');
  const warning = $('timeEntryMixedCaseWarning');
  const generateBtn = $('timeEntryGenerateInvoiceBtn');
  if (!bar) return;

  const count = selectedTimeEntryIds.size;
  $('timeEntrySelectAll').indeterminate = count > 0 && count < $$('#timeEntryTableBody .time-entry-checkbox').length;
  $('timeEntrySelectAll').checked = count > 0 && count === $$('#timeEntryTableBody .time-entry-checkbox').length;

  if (count === 0) {
    bar.classList.add('hidden');
    warning.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');
  $('timeEntryBulkCount').textContent = `${count} selected`;

  const selectedEntries = TIME_ENTRIES.filter(t => selectedTimeEntryIds.has(t.id));
  const caseIds = new Set(selectedEntries.map(t => t.case_id));
  const mixed = caseIds.size > 1;
  warning.classList.toggle('hidden', !mixed);
  generateBtn.disabled = mixed;
  generateBtn.style.opacity = mixed ? '0.5' : '1';
}

function clearTimeEntrySelection() {
  selectedTimeEntryIds.clear();
  $$('#timeEntryTableBody .time-entry-checkbox').forEach(box => { box.checked = false; });
  updateTimeEntryBulkBar();
}

// `entryId` is null for "Log Time" (create mode) or a real entry id for
// "Edit" (row action, only ever offered for an unbilled entry the caller
// is allowed to edit — see renderTimeEntryTable's canEditOrDelete).
function openTimeEntryModal(entryId) {
  closeAllActionsDropdowns();
  const entry = entryId ? TIME_ENTRIES.find(t => t.id === entryId) : null;
  currentTimeEntryEditId = entry ? entry.id : null;

  const caseSelect = $('timeEntryCase');
  caseSelect.innerHTML = '<option value="">Select a case…</option>' +
    CASES.map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.id)} — ${escapeHtml(c.name)}</option>`).join('');

  if (entry) {
    $('timeEntryModalTitle').textContent = 'Edit Time Entry';
    $('timeEntrySubmitBtn').textContent = 'Save Changes';
    caseSelect.value = entry.case_id;
    $('timeEntryDate').value = entry.entry_date;
    $('timeEntryHours').value = (entry.minutes / 60).toFixed(2).replace(/\.?0+$/, '') || '0';
    $('timeEntryRate').value = (entry.rate_cents / 100).toFixed(2);
    $('timeEntryDescription').value = entry.description;
    $('timeEntryBillable').checked = entry.billable;
  } else {
    $('timeEntryForm').reset();
    $('timeEntryModalTitle').textContent = 'Log Time';
    $('timeEntrySubmitBtn').textContent = 'Log Time';
    caseSelect.value = '';
    $('timeEntryDate').value = new Date().toISOString().slice(0, 10);
    $('timeEntryBillable').checked = true;
    // Prefill from the signed-in user's own default rate, if one is set
    // (see users.default_rate_cents) — still freely editable per entry.
    const user = Auth.getUser();
    if (user && user.default_rate_cents !== undefined && user.default_rate_cents !== null) {
      $('timeEntryRate').value = (user.default_rate_cents / 100).toFixed(2);
    } else {
      $('timeEntryRate').value = '';
    }
  }

  const modal = $('timeEntryModal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);
}

function closeTimeEntryModal() {
  const modal = $('timeEntryModal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.classList.add('hidden'), 300);
    $('timeEntryForm').reset();
    currentTimeEntryEditId = null;
  }
}

async function handleTimeEntrySubmit(e) {
  e.preventDefault();

  const caseId = $('timeEntryCase').value;
  const hours = parseFloat($('timeEntryHours').value);
  const rateDollars = parseFloat($('timeEntryRate').value);
  const description = $('timeEntryDescription').value.trim();
  const billable = $('timeEntryBillable').checked;
  const entryDate = $('timeEntryDate').value || null;

  if (!caseId) {
    showToast('Select a case.', 'error');
    return;
  }
  if (!Number.isFinite(hours) || hours <= 0) {
    showToast('Enter a valid number of hours.', 'error');
    return;
  }
  if (!Number.isFinite(rateDollars) || rateDollars < 0) {
    showToast('Enter a valid, non-negative rate.', 'error');
    return;
  }
  if (!description) {
    showToast('Enter a description of the work performed.', 'error');
    return;
  }

  // Hours -> whole minutes on the wire, same reasoning as amount_cents:
  // see db/migrations/0021_time_tracking_and_invoice_line_items.sql's
  // comment on why time is stored as an exact integer, not a float hour.
  const minutes = Math.round(hours * 60);
  const rateCents = Math.round(rateDollars * 100);

  const isEdit = !!currentTimeEntryEditId;
  const submitBtn = $('timeEntrySubmitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = isEdit ? 'Saving…' : 'Logging…';

  try {
    if (isEdit) {
      await ApiClient.patch(`/api/v1/time-entries/${currentTimeEntryEditId}`, {
        case_id: caseId, entry_date: entryDate, minutes, rate_cents: rateCents, description, billable
      });
      showToast('Time entry updated.', 'success');
    } else {
      await ApiClient.post('/api/v1/time-entries', {
        case_id: caseId, entry_date: entryDate, minutes, rate_cents: rateCents, description, billable
      });
      showToast('Time logged.', 'success');
    }

    closeTimeEntryModal();
    await loadTimeEntries();
  } catch (err) {
    showToast(err.message || 'Failed to save time entry.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = isEdit ? 'Save Changes' : 'Log Time';
  }
}

async function handleDeleteTimeEntry(entryId, description) {
  closeAllActionsDropdowns();
  const confirmed = confirm(`Delete this time entry ("${description}")? This cannot be undone.`);
  if (!confirmed) return;

  try {
    await ApiClient.del(`/api/v1/time-entries/${entryId}`);
    showToast('Time entry deleted.', 'success');
    await loadTimeEntries();
  } catch (err) {
    showToast(err.message || 'Failed to delete time entry.', 'error');
  }
}

async function handleGenerateInvoiceFromTime() {
  const selectedEntries = TIME_ENTRIES.filter(t => selectedTimeEntryIds.has(t.id));
  if (!selectedEntries.length) return;

  const caseIds = new Set(selectedEntries.map(t => t.case_id));
  if (caseIds.size > 1) return; // button is disabled in this state; belt and suspenders

  const caseId = [...caseIds][0];
  const totalHours = selectedEntries.reduce((sum, t) => sum + t.minutes, 0) / 60;
  const totalAmount = selectedEntries.reduce((sum, t) => sum + t.amount_cents, 0);
  const caseLabel = selectedEntries[0].case_name || caseId;

  const confirmed = confirm(
    `Generate an invoice for ${selectedEntries.length} time ${selectedEntries.length === 1 ? 'entry' : 'entries'} ` +
    `(${totalHours.toFixed(1)}h, ${formatMoney(totalAmount)}) against ${caseLabel}?`
  );
  if (!confirmed) return;

  const btn = $('timeEntryGenerateInvoiceBtn');
  btn.disabled = true;
  btn.textContent = 'Generating…';

  try {
    const { ok, json } = await ApiClient.post('/api/v1/invoices/from-time-entries', {
      case_id: caseId,
      time_entry_ids: [...selectedTimeEntryIds]
    });
    if (!ok) throw new Error(json.error || 'Failed to generate invoice.');

    showToast(`Invoice ${json.data.invoice_number} generated (${formatMoney(json.data.amount_cents)}).`, 'success');
    clearTimeEntrySelection();
    await loadTimeEntries();
    await loadInvoices();
  } catch (err) {
    showToast(err.message || 'Failed to generate invoice.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Invoice';
  }
}

registerActions({
  'submit-time-entry': (el, event) => handleTimeEntrySubmit(event),
  'open-time-entry-modal': (el) => openTimeEntryModal(el.dataset.entryId),
  'delete-time-entry': (el) => handleDeleteTimeEntry(el.dataset.entryId, el.dataset.entryDescription),
  'generate-invoice-from-time': () => handleGenerateInvoiceFromTime(),
  'clear-time-entry-selection': () => clearTimeEntrySelection(),
});

/* ════════════════════════════════════════════
   TRUST ACCOUNTING PAGE
   Client trust funds, deliberately kept out of the INVOICES array and
   every billing helper above — see server/services/trustService.js for
   why they're segregated at the data-model level too, not just in this
   UI. Re-fetches on every visit (initTrustPage), matching
   initBillingPage/initCasesPage.
   ════════════════════════════════════════════ */

let TRUST_ACCOUNTS = [];
let TRUST_LEDGERS = [];
let trustListenersInitialized = false;
let trustCurrentLedgerId = null; // ledger the open Deposit/Disbursement/Transfer/History modal refers to

function initTrustPage() {
  if (!canManageTrust()) {
    // Belt-and-suspenders: the nav item is already hidden for anyone who
    // isn't PARTNER+ (applyRolePermissionsToChrome), but a direct
    // navigateToPage('trust') call shouldn't render financial data either.
    $('trustPage').innerHTML = '<p style="padding:40px;color:var(--slate-400)">You do not have access to Trust Accounting.</p>';
    return;
  }
  setupTrustPageListeners();
  loadTrustAccounts();
}

async function loadTrustAccounts() {
  try {
    TRUST_ACCOUNTS = await ApiClient.get('/api/v1/trust/accounts');
    const select = $('trustAccountSelect');
    select.innerHTML = TRUST_ACCOUNTS.map(a => `<option value="${escapeAttr(a.id)}">${escapeHtml(a.account_name)}</option>`).join('')
      || '<option value="">No trust accounts configured</option>';
    await loadTrustLedgers();
    await loadTrustReconciliationHistory();
  } catch (err) {
    showToast(err.message || 'Failed to load trust accounts.', 'error');
  }
}

function selectedTrustAccountId() {
  return $('trustAccountSelect').value || null;
}

async function loadTrustLedgers() {
  const accountId = selectedTrustAccountId();
  const tbody = $('trustLedgersTableBody');
  try {
    TRUST_LEDGERS = accountId ? await ApiClient.get(`/api/v1/trust/client-ledgers?trust_account_id=${accountId}`) : [];
    renderTrustLedgers();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--slate-400)">Error loading client ledgers</td></tr>`;
  }
}

function renderTrustLedgers() {
  const tbody = $('trustLedgersTableBody');
  const emptyState = $('trustLedgersEmptyState');
  const table = $('trustLedgersTable');
  if (!tbody) return;

  if (TRUST_LEDGERS.length === 0) {
    table.classList.add('hidden');
    emptyState.classList.remove('hidden');
    return;
  }
  table.classList.remove('hidden');
  emptyState.classList.add('hidden');

  tbody.innerHTML = TRUST_LEDGERS.map(l => `
    <tr>
      <td>${escapeHtml(l.client_display_name)}</td>
      <td>${escapeHtml(l.trust_account_name)}</td>
      <td style="font-weight:600">${formatMoney(l.balance_cents)}</td>
      <td class="activity-time">${l.last_activity_at ? formatInvoiceDate(l.last_activity_at.slice(0, 10)) : '—'}</td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn-ghost" style="padding:4px 8px; font-size:12px;" data-action="open-trust-entry" data-ledger-id="${escapeAttr(l.id)}" data-entry-type="DEPOSIT">Deposit</button>
          <button class="btn-ghost" style="padding:4px 8px; font-size:12px;" data-action="open-trust-entry" data-ledger-id="${escapeAttr(l.id)}" data-entry-type="DISBURSEMENT">Disburse</button>
          <button class="btn-ghost" style="padding:4px 8px; font-size:12px;" data-action="open-trust-transfer" data-ledger-id="${escapeAttr(l.id)}">Pay Invoice</button>
          <button class="btn-ghost" style="padding:4px 8px; font-size:12px;" data-action="open-trust-history" data-ledger-id="${escapeAttr(l.id)}">History</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function trustLedgerById(ledgerId) {
  return TRUST_LEDGERS.find(l => l.id === ledgerId);
}

function setupTrustPageListeners() {
  if (trustListenersInitialized) return;
  trustListenersInitialized = true;

  $('trustAccountSelect').addEventListener('change', () => { loadTrustLedgers(); loadTrustReconciliationHistory(); });

  // New Client Ledger modal
  $('trustNewLedgerBtn').addEventListener('click', openTrustLedgerModal);
  $('trustLedgerModalCloseBtn').addEventListener('click', closeTrustLedgerModal);
  $('trustLedgerModalCancelBtn').addEventListener('click', closeTrustLedgerModal);
  $('trustLedgerModal').addEventListener('click', (e) => { if (e.target === $('trustLedgerModal')) closeTrustLedgerModal(); });

  // Deposit/Disbursement modal
  $('trustEntryModalCloseBtn').addEventListener('click', closeTrustEntryModal);
  $('trustEntryModalCancelBtn').addEventListener('click', closeTrustEntryModal);
  $('trustEntryModal').addEventListener('click', (e) => { if (e.target === $('trustEntryModal')) closeTrustEntryModal(); });

  // Transfer-to-operating modal
  $('trustTransferModalCloseBtn').addEventListener('click', closeTrustTransferModal);
  $('trustTransferModalCancelBtn').addEventListener('click', closeTrustTransferModal);
  $('trustTransferModal').addEventListener('click', (e) => { if (e.target === $('trustTransferModal')) closeTrustTransferModal(); });

  // History modal
  $('trustHistoryModalCloseBtn').addEventListener('click', closeTrustHistoryModal);
  $('trustHistoryModal').addEventListener('click', (e) => { if (e.target === $('trustHistoryModal')) closeTrustHistoryModal(); });

  // Reconciliation
  $('trustReconComputeBtn').addEventListener('click', computeTrustReconciliation);
  $('trustReconSaveBtn').addEventListener('click', saveTrustReconciliation);
  $('trustReconAsOf').valueAsDate = new Date();
}

// ── New Client Ledger ────────────────────────────────────────────────────
function openTrustLedgerModal() {
  $('trustLedgerForm').reset();
  const accountSelect = $('trustLedgerAccount');
  accountSelect.innerHTML = TRUST_ACCOUNTS.map(a => `<option value="${a.id}">${a.account_name}</option>`).join('');
  accountSelect.value = selectedTrustAccountId() || '';
  const modal = $('trustLedgerModal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);
}

function closeTrustLedgerModal() {
  const modal = $('trustLedgerModal');
  modal.classList.remove('active');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

async function handleTrustLedgerSubmit(e) {
  e.preventDefault();
  const trustAccountId = $('trustLedgerAccount').value;
  const clientName = $('trustLedgerClientName').value.trim();
  if (!trustAccountId || !clientName) return;

  const submitBtn = $('trustLedgerSubmitBtn');
  submitBtn.disabled = true;
  try {
    const { ok, json } = await ApiClient.post('/api/v1/trust/client-ledgers', {
      trust_account_id: trustAccountId, client_display_name: clientName
    });
    if (!ok) throw new Error(json.error || 'Failed to create client ledger.');
    showToast(`Trust ledger opened for ${clientName}.`, 'success');
    closeTrustLedgerModal();
    if (trustAccountId === selectedTrustAccountId()) await loadTrustLedgers();
  } catch (err) {
    showToast(err.message || 'Failed to create client ledger.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

// ── Deposit / Disbursement ───────────────────────────────────────────────
function openTrustEntryModal(ledgerId, type) {
  const ledger = trustLedgerById(ledgerId);
  if (!ledger) return;
  trustCurrentLedgerId = ledgerId;

  $('trustEntryForm').reset();
  $('trustEntryLedgerId').value = ledgerId;
  $('trustEntryType').value = type;
  $('trustEntryClientName').textContent = `${ledger.client_display_name} — current balance ${formatMoney(ledger.balance_cents)}`;

  const isDeposit = type === 'DEPOSIT';
  $('trustEntryModalTitle').textContent = isDeposit ? 'Record Deposit' : 'Record Disbursement';
  $('trustEntrySubmitBtn').textContent = isDeposit ? 'Record Deposit' : 'Record Disbursement';

  const modal = $('trustEntryModal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);
}

function closeTrustEntryModal() {
  const modal = $('trustEntryModal');
  modal.classList.remove('active');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

async function handleTrustEntrySubmit(e) {
  e.preventDefault();
  const ledgerId = $('trustEntryLedgerId').value;
  const type = $('trustEntryType').value;
  const amountDollars = parseFloat($('trustEntryAmount').value);
  const memo = $('trustEntryMemo').value.trim();
  const checkNumber = $('trustEntryCheckNumber').value.trim();

  if (!amountDollars || amountDollars <= 0) return showToast('Enter a valid, positive amount.', 'error');
  // Money is transmitted in cents so it never touches a float on the wire —
  // same convention as invoice amounts (see formatMoney's own comment).
  const amountCents = Math.round(amountDollars * 100);

  const submitBtn = $('trustEntrySubmitBtn');
  submitBtn.disabled = true;
  try {
    const endpoint = type === 'DEPOSIT' ? '/api/v1/trust/deposits' : '/api/v1/trust/disbursements';
    const { ok, json } = await ApiClient.post(endpoint, {
      client_ledger_id: ledgerId, amount_cents: amountCents, memo, check_number: checkNumber || undefined
    });
    if (!ok) throw new Error(json.error || 'Failed to record transaction.');
    showToast(type === 'DEPOSIT' ? 'Deposit recorded.' : 'Disbursement recorded.', 'success');
    closeTrustEntryModal();
    await loadTrustLedgers();
  } catch (err) {
    showToast(err.message || 'Failed to record transaction.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

// ── Pay Invoice From Trust (transfer to operating) ───────────────────────
async function openTrustTransferModal(ledgerId) {
  const ledger = trustLedgerById(ledgerId);
  if (!ledger) return;
  trustCurrentLedgerId = ledgerId;

  $('trustTransferForm').reset();
  $('trustTransferLedgerId').value = ledgerId;
  $('trustTransferClientName').textContent = `${ledger.client_display_name} — current balance ${formatMoney(ledger.balance_cents)}`;

  const select = $('trustTransferInvoice');
  select.innerHTML = '<option value="">Loading invoices…</option>';
  const modal = $('trustTransferModal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);

  try {
    // INVOICES is populated by loadInvoices() (Billing page) — re-fetch
    // here too so this modal works even if Billing hasn't been visited yet
    // this session.
    const invoices = await ApiClient.get('/api/v1/invoices');
    const unpaid = invoices.filter(inv => inv.status !== 'paid' && inv.status !== 'void');
    select.innerHTML = unpaid.length
      ? unpaid.map(inv => `<option value="${inv.id}" data-amount-cents="${inv.amount_cents}">${inv.invoice_number} — ${formatMoney(inv.amount_cents)}${inv.case_name ? ' — ' + inv.case_name : ''}</option>`).join('')
      : '<option value="">No unpaid invoices</option>';
  } catch (err) {
    select.innerHTML = '<option value="">Error loading invoices</option>';
  }
}

function closeTrustTransferModal() {
  const modal = $('trustTransferModal');
  modal.classList.remove('active');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

async function handleTrustTransferSubmit(e) {
  e.preventDefault();
  const ledgerId = $('trustTransferLedgerId').value;
  const select = $('trustTransferInvoice');
  const invoiceId = select.value;
  const memo = $('trustTransferMemo').value.trim();
  if (!invoiceId) return showToast('Select an unpaid invoice.', 'error');

  const amountCents = parseInt(select.selectedOptions[0]?.dataset.amountCents || '0', 10);

  const submitBtn = $('trustTransferSubmitBtn');
  submitBtn.disabled = true;
  try {
    const { ok, json } = await ApiClient.post('/api/v1/trust/transfers', {
      client_ledger_id: ledgerId, invoice_id: invoiceId, amount_cents: amountCents, memo
    });
    if (!ok) throw new Error(json.error || 'Failed to transfer trust funds.');
    showToast('Invoice paid from trust and marked paid.', 'success');
    closeTrustTransferModal();
    await loadTrustLedgers();
    if (typeof loadInvoices === 'function') await loadInvoices();
  } catch (err) {
    showToast(err.message || 'Failed to transfer trust funds.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

// ── Transaction History (+ reverse) ──────────────────────────────────────
const TRUST_TXN_TYPE_LABEL = {
  DEPOSIT: 'Deposit', DISBURSEMENT: 'Disbursement',
  TRANSFER_TO_OPERATING: 'Transfer to Operating', ADJUSTMENT_REVERSAL: 'Reversal'
};

async function openTrustHistoryModal(ledgerId) {
  const ledger = trustLedgerById(ledgerId);
  if (!ledger) return;
  trustCurrentLedgerId = ledgerId;
  $('trustHistoryModalTitle').textContent = `Transaction History — ${ledger.client_display_name}`;

  const modal = $('trustHistoryModal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);

  const tbody = $('trustHistoryTableBody');
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--slate-400)">Loading…</td></tr>`;
  try {
    const rows = await ApiClient.get(`/api/v1/trust/client-ledgers/${ledgerId}/transactions`);
    tbody.innerHTML = rows.length ? rows.map(t => `
      <tr>
        <td class="activity-time">${formatInvoiceDate(t.created_at.slice(0, 10))}</td>
        <td>${TRUST_TXN_TYPE_LABEL[t.type] || t.type}</td>
        <td>${formatMoney(t.amount_cents)}</td>
        <td>${(t.memo || '').replace(/</g, '&lt;')}</td>
        <td>${t.created_by_name || '—'}</td>
        <td>${t.type !== 'ADJUSTMENT_REVERSAL' ? `<button class="btn-ghost" style="padding:2px 8px; font-size:12px;" data-action="trust-reverse" data-transaction-id="${escapeAttr(t.id)}" data-ledger-id="${escapeAttr(ledgerId)}">Reverse</button>` : ''}</td>
      </tr>
    `).join('') : `<tr><td colspan="6" style="text-align:center;color:var(--slate-400)">No transactions yet</td></tr>`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--slate-400)">Error loading history</td></tr>`;
  }
}

function closeTrustHistoryModal() {
  const modal = $('trustHistoryModal');
  modal.classList.remove('active');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

async function handleTrustReverse(transactionId, ledgerId) {
  const reason = prompt('Reason for reversing this transaction (required — becomes part of the trust ledger\'s record):');
  if (!reason || !reason.trim()) return;

  try {
    const { ok, json } = await ApiClient.post(`/api/v1/trust/transactions/${transactionId}/reverse`, { reason: reason.trim() });
    if (!ok) throw new Error(json.error || 'Failed to reverse transaction.');
    showToast('Transaction reversed.', 'success');
    await loadTrustLedgers();
    await openTrustHistoryModal(ledgerId);
  } catch (err) {
    showToast(err.message || 'Failed to reverse transaction.', 'error');
  }
}

// ── Three-Way Reconciliation ──────────────────────────────────────────────
async function computeTrustReconciliation() {
  const accountId = selectedTrustAccountId();
  if (!accountId) return showToast('Select a trust account first.', 'error');

  const asOf = $('trustReconAsOf').value;
  const bankDollars = parseFloat($('trustReconBankBalance').value);
  if (isNaN(bankDollars) || bankDollars < 0) return showToast('Enter the bank statement balance.', 'error');
  const bankCents = Math.round(bankDollars * 100);

  try {
    const params = new URLSearchParams({ trust_account_id: accountId, bank_balance_cents: bankCents });
    if (asOf) params.set('as_of', asOf);
    const result = await ApiClient.get(`/api/v1/trust/reconciliation?${params.toString()}`);

    $('trustReconBank').textContent = formatMoney(result.bank_statement_balance_cents);
    $('trustReconLedger').textContent = formatMoney(result.ledger_balance_cents);
    $('trustReconClientTotal').textContent = formatMoney(result.client_ledgers_total_cents);
    const badge = $('trustReconStatusBadge');
    badge.textContent = result.is_balanced ? 'Balanced' : `Out of balance (${formatMoney(Math.abs(result.discrepancy_cents))})`;
    badge.className = 'status-badge ' + (result.is_balanced ? 'active' : 'urgent');
    $('trustReconResult').classList.remove('hidden');
    $('trustReconResult').dataset.computed = JSON.stringify(result);
  } catch (err) {
    showToast(err.message || 'Failed to compute reconciliation.', 'error');
  }
}

async function saveTrustReconciliation() {
  const accountId = selectedTrustAccountId();
  const computed = $('trustReconResult').dataset.computed ? JSON.parse($('trustReconResult').dataset.computed) : null;
  if (!accountId || !computed) return showToast('Compute the reconciliation before saving.', 'error');

  const saveBtn = $('trustReconSaveBtn');
  saveBtn.disabled = true;
  try {
    const { ok, json } = await ApiClient.post('/api/v1/trust/reconciliation', {
      trust_account_id: accountId,
      as_of_date: computed.as_of_date,
      bank_statement_balance_cents: computed.bank_statement_balance_cents,
      notes: $('trustReconNotes').value.trim() || undefined
    });
    if (!ok) throw new Error(json.error || 'Failed to save reconciliation.');
    showToast('Reconciliation saved.', 'success');
    await loadTrustReconciliationHistory();
  } catch (err) {
    showToast(err.message || 'Failed to save reconciliation.', 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

async function loadTrustReconciliationHistory() {
  const accountId = selectedTrustAccountId();
  const tbody = $('trustReconHistoryTableBody');
  if (!accountId) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--slate-400)">Select a trust account</td></tr>`;
    return;
  }
  try {
    const rows = await ApiClient.get(`/api/v1/trust/reconciliation/history?trust_account_id=${accountId}`);
    tbody.innerHTML = rows.length ? rows.map(r => `
      <tr>
        <td class="activity-time">${formatInvoiceDate(r.as_of_date)}</td>
        <td>${formatMoney(r.bank_statement_balance_cents)}</td>
        <td>${formatMoney(r.ledger_balance_cents)}</td>
        <td>${formatMoney(r.client_ledgers_total_cents)}</td>
        <td><span class="status-badge ${r.is_balanced ? 'active' : 'urgent'}">${r.is_balanced ? 'Balanced' : 'Out of balance'}</span></td>
        <td>${r.performed_by_name || '—'}</td>
      </tr>
    `).join('') : `<tr><td colspan="6" style="text-align:center;color:var(--slate-400)">No reconciliations recorded yet</td></tr>`;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--slate-400)">Error loading reconciliation history</td></tr>`;
  }
}

// ══════════════════════════════════════
// TOAST NOTIFICATION
// ══════════════════════════════════════

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    background:var(--navy-700); color:var(--white); padding:12px 20px;
    border-radius:10px; font-size:13px; font-weight:500;
    border:1px solid rgba(255,255,255,0.1);
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    transform:translateY(80px); opacity:0;
    transition:all 0.3s cubic-bezier(0.4,0,0.2,1);
    display:flex; align-items:center; gap:10px;
  `;
  const colors = { info: '#3B82F6', success: '#2ECC71', warning: '#F39C12', error: '#E74C3C' };
  // escapeHtml(message): found during a security review that several
  // call sites pass a user-controlled value straight through (an
  // uploaded file's own name, an API error string that can echo back
  // caller input) — this used to be raw innerHTML, so any of those could
  // inject markup into every viewer's page. No call site anywhere in the
  // app intentionally passes real HTML to showToast (checked before
  // making this change), so escaping unconditionally is safe.
  toast.innerHTML = `
    <div style="width:6px;height:6px;border-radius:50%;background:${colors[type]};flex-shrink:0"></div>
    ${escapeHtml(message)}
  `;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    });
  });

  setTimeout(() => {
    toast.style.transform = 'translateY(80px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ══════════════════════════════════════
// KEYBOARD SHORTCUT
// ══════════════════════════════════════

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    $('globalSearch').focus();
  }
});

// ══════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════


/* ════════════════════════════════════════════
   CLIENT COMMUNICATIONS DATA LAYER
   STATUS: real data from GET /api/v1/conversations and
   GET /api/v1/conversations/:id (server/services/communicationsService.js)
   — populated by loadConversations()/loadConversationDetail(), not a
   literal. Role-scoped and note-filtered server-side: see the file header
   comment in communicationsService.js.
   ════════════════════════════════════════════ */

let CONVERSATIONS = [];

/* ════════════════════════════════════════════
   CLIENT COMMUNICATIONS HUB CONTROLLER
   ════════════════════════════════════════════ */

let activeConvId = null;
let commsSearchQuery = "";
let commsListenersInitialized = false;

function initCommsPage() {
  renderCommsSidebar();
  renderActiveChat();
  setupCommsPageListeners();
  loadConversations(); // re-fetch on every visit, same pattern as initDocumentVault
}

function renderCommsSidebar() {
  const list = $('commsConvList');
  if (!list) return;

  const filtered = CONVERSATIONS.filter(c => {
    const q = commsSearchQuery.toLowerCase();
    return c.clientName.toLowerCase().includes(q) ||
           (c.caseId || '').toLowerCase().includes(q) ||
           (c.caseName || '').toLowerCase().includes(q);
  });

  list.innerHTML = filtered.map(c => {
    // `preview` (last-message text, already formatted as "[Note] ..." when
    // the last message was a staff note) comes straight from the API —
    // see communicationsService.js's toConversationSummaryView — rather
    // than being derived from c.messages, which isn't populated for every
    // conversation in the list, only the one whose thread has been opened.
    const previewText = c.preview || 'No messages yet';

    return `
      <div class="comms-conv-item ${c.id === activeConvId ? 'active' : ''}" data-action="select-conversation" data-conversation-id="${escapeAttr(c.id)}">
        <div class="conv-avatar" style="background:${c.color}22; color:${c.color}">
          ${escapeHtml(c.initials)}
        </div>
        <div class="conv-info">
          <div class="conv-header-row">
            <span class="conv-name">${escapeHtml(c.clientName)}</span>
            <span class="conv-case-id">${escapeHtml(c.caseId)}</span>
          </div>
          <div class="conv-header-row">
            <span class="conv-preview" title="${escapeAttr(previewText)}">${escapeHtml(previewText)}</span>
            ${c.unread > 0 ? `<span class="conv-badge">${c.unread}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderActiveChat() {
  const header = $('commsChatHeader');
  const stream = $('commsChatStream');
  if (!header || !stream) return;

  const conv = CONVERSATIONS.find(c => c.id === activeConvId);
  if (!conv) {
    header.innerHTML = `<div>Select a conversation to begin</div>`;
    stream.innerHTML = '';
    return;
  }

  const statusLabels = {
    active: 'Active Case',
    pending: 'Awaiting Docs',
    urgent: 'Urgent Deadline',
    closed: 'Closed'
  };
  const statusLabel = statusLabels[conv.status] || conv.status;
  
  // No "View Full Client Portal" button here: it used to fire a toast
  // claiming to load one, but there is nothing in this app for it to load
  // — the client portal (client-portal.js/client-portal.html) is a
  // separate, independently-authenticated app for CLIENT-role users, not
  // something a staff session can open. Removed rather than left as a
  // dead button, per the header's own real content (this conversation's
  // messages, rendered below) being the actual substitute.
  header.innerHTML = `
    <div class="chat-header-left">
      <div class="chat-header-title">${escapeHtml(conv.clientName)}</div>
      <div class="chat-header-subtitle">
        <span>${escapeHtml(conv.caseName)}</span>
        <div style="width:4px;height:4px;border-radius:50%;background:var(--slate-400)"></div>
        <span class="status-badge ${conv.status}" style="font-size:10px; padding: 1px 6px;">${statusLabel}</span>
      </div>
    </div>
  `;

  // conv.messages is only populated once loadConversationDetail(id) has
  // fetched the full thread for this specific conversation — the sidebar
  // list endpoint doesn't include message bodies at all.
  if (!conv.messages) {
    stream.innerHTML = `<div style="text-align:center;color:var(--slate-400);padding:24px">Loading messages…</div>`;
    return;
  }

  stream.innerHTML = conv.messages.map(m => {
    const attachmentHtml = renderCommsAttachmentChip(m.attachment);
    if (m.isNote) {
      return `
        <div class="message-row internal-note-side">
          <div class="message-bubble">
            <div class="note-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px;">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              Internal Firm Note &mdash; Hidden from Client
            </div>
            <div>${escapeHtml(m.text)}</div>
            ${attachmentHtml}
          </div>
          <span class="message-meta">${escapeHtml(m.time)}</span>
        </div>
      `;
    } else if (m.sender === 'client') {
      return `
        <div class="message-row client-side">
          <div class="message-bubble">${escapeHtml(m.text)}${attachmentHtml}</div>
          <span class="message-meta">${escapeHtml(m.time)}</span>
        </div>
      `;
    } else {
      return `
        <div class="message-row staff-side">
          <div class="message-bubble">${escapeHtml(m.text)}${attachmentHtml}</div>
          <span class="message-meta">${escapeHtml(m.time)}</span>
        </div>
      `;
    }
  }).join('');

  setTimeout(() => {
    stream.scrollTop = stream.scrollHeight;
  }, 20);
}

// A message's `attachment` (see server/services/communicationsService.js's
// toAttachmentView) is a real document reference now, not just a
// plain-text mention — renders as a clickable chip that downloads through
// the same vault download endpoint every other document uses.
function renderCommsAttachmentChip(attachment) {
  if (!attachment) return '';
  return `
    <a class="comms-attachment-chip" href="/api/v1/files/${escapeAttr(attachment.documentId)}/download"
       target="_blank" rel="noopener" style="display:flex;align-items:center;gap:6px;margin-top:8px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.08);text-decoration:none;color:inherit;font-size:12px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
      </svg>
      <span>${escapeHtml(attachment.name)}</span>
    </a>
  `;
}

async function selectConversation(id) {
  activeConvId = id;
  const conv = CONVERSATIONS.find(c => c.id === id);
  if (conv) conv.unread = 0;
  renderCommsSidebar();
  renderActiveChat(); // shows the summary row immediately; loadConversationDetail below fills in the message thread (and re-renders) once it arrives
  await loadConversationDetail(id);
}

function setupCommsPageListeners() {
  if (commsListenersInitialized) return;

  $('commsSearchInput').addEventListener('input', (e) => {
    commsSearchQuery = e.target.value;
    renderCommsSidebar();
  });

  const toggle = $('internalNoteToggle');
  const toggleLabel = $('toggleLabelText');
  const toggleRow = document.querySelector('.comms-input-toggle-row');
  const inputBoxWrap = document.querySelector('.comms-input-box-wrap');
  const btnSendText = $('btnSendText');
  const btnSendSecure = $('btnSendSecure');

  toggle.addEventListener('change', () => {
    const isNote = toggle.checked;
    if (isNote) {
      toggleLabel.textContent = "Internal Firm Note (Hidden from Client)";
      toggleRow.classList.add('note-active');
      inputBoxWrap.classList.add('note-active');
      btnSendText.textContent = "Save Internal Note";
      btnSendSecure.classList.add('note-send-btn');
      $('commsMessageInput').placeholder = "Type internal staff memo...";
    } else {
      toggleLabel.textContent = "Sending Secure Client Message";
      toggleRow.classList.remove('note-active');
      inputBoxWrap.classList.remove('note-active');
      btnSendText.textContent = "Send via Secure Portal";
      btnSendSecure.classList.remove('note-send-btn');
      $('commsMessageInput').placeholder = "Type a message or internal note...";
    }
  });

  const textarea = $('commsMessageInput');
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = (textarea.scrollHeight) + 'px';
  });

  $('signatureRequestModalCloseBtn').addEventListener('click', closeSignatureRequestModal);
  $('signatureRequestModalCancelBtn').addEventListener('click', closeSignatureRequestModal);
  $('signatureRequestModal').addEventListener('click', (e) => {
    if (e.target === $('signatureRequestModal')) closeSignatureRequestModal();
  });
  $('signatureLinkModalCloseBtn').addEventListener('click', closeSignatureLinkModal);
  $('signatureLinkModal').addEventListener('click', (e) => {
    if (e.target === $('signatureLinkModal')) closeSignatureLinkModal();
  });
  $('signatureLinkCopyBtn').addEventListener('click', async () => {
    const input = $('signatureLinkValue');
    try {
      await navigator.clipboard.writeText(input.value);
      showToast('Signing link copied to clipboard.', 'success');
    } catch {
      input.select();
      showToast('Could not access clipboard — link is selected, copy it manually.', 'error');
    }
  });

  commsListenersInitialized = true;
}

async function handleSendCommsMessage(event) {
  event.preventDefault();
  const input = $('commsMessageInput');
  const toggle = $('internalNoteToggle');
  const text = input.value.trim();

  if ((!text && !pendingCommsAttachment) || !activeConvId) return;

  const isNote = toggle.checked;
  const sendBtn = $('btnSendSecure');
  if (sendBtn) sendBtn.disabled = true;

  try {
    // isNote is sent as a hint, but the server decides the actual sender
    // — a CLIENT-role caller can never produce a note even if this box is
    // somehow checked (see communicationsService.postMessage).
    const payload = { text: text || `Shared a file: ${pendingCommsAttachment?.name || ''}`, isNote };
    if (pendingCommsAttachment) payload.attachmentDocumentId = pendingCommsAttachment.id;

    const { ok, json } = await ApiClient.post(`/api/v1/conversations/${activeConvId}/messages`, payload);
    if (!ok) throw new Error(json.error || 'Failed to send message.');

    input.value = '';
    input.style.height = 'auto';
    clearPendingCommsAttachment();
    await loadConversationDetail(activeConvId); // re-fetch the thread so the new message renders with its server-assigned id/timestamp

    showToast(isNote ? 'Internal Firm Note saved securely.' : 'Secure Client Message Transmitted successfully.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to send message.', 'error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// `event` is only used by the 'template' action, to position its dropdown
// under the button that opened it — the HTML's onclick for that button
// passes it explicitly (see index.html); 'attach' doesn't need it.
function handleInputQuickAction(action, event) {
  if (action === 'attach') {
    handleCommsAttachClick();
  } else if (action === 'template') {
    toggleCommsTemplateMenu(event.currentTarget);
  } else if (action === 'signature') {
    openSignatureRequestModal();
  }
}

// ── Attach (quick action) ─────────────────────────────────────────────────
// Reuses the exact same upload path the Document Vault and Cases pages
// already use (ApiClient.postForm -> POST /api/v1/vault/upload ->
// VaultService.initiateUpload) — no new storage/upload code. The uploaded
// document's real id is held as a pending attachment (see
// renderPendingCommsAttachment below) and sent as `attachmentDocumentId`
// on the next POST /conversations/:id/messages — a structured link via
// conversation_messages.attachment_document_id (migration 0018), not a
// plain-text mention the sender could edit into something misleading.
let pendingCommsAttachment = null; // { id, name } | null

function handleCommsAttachClick() {
  const conv = CONVERSATIONS.find(c => c.id === activeConvId);
  if (!conv) return showToast('Select a conversation first.', 'error');

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (file) uploadCommsAttachment(file, conv);
  });
  input.click();
}

async function uploadCommsAttachment(file, conv) {
  showToast(`Uploading ${file.name}…`, 'info');
  try {
    const formData = new FormData();
    formData.append('file', file);
    if (conv.caseId) formData.append('case_id', conv.caseId);
    formData.append('tags', JSON.stringify([]));

    const res = await ApiClient.postForm('/api/v1/vault/upload', formData);
    if (!res.ok) throw new Error(res.json?.error || `Upload failed for ${file.name}.`);

    pendingCommsAttachment = { id: res.json.data.document.id, name: file.name };
    renderPendingCommsAttachment();
    showToast(`${file.name} uploaded — will be attached to your next message.`, 'success');
  } catch (err) {
    showToast(err.message || 'Failed to upload attachment.', 'error');
  }
}

function renderPendingCommsAttachment() {
  const wrap = $('commsPendingAttachment');
  if (!wrap) return;
  if (!pendingCommsAttachment) {
    wrap.innerHTML = '';
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  wrap.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.08);">
      📎 ${escapeHtml(pendingCommsAttachment.name)}
      <button type="button" data-action="clear-comms-attachment" style="background:none;border:none;color:inherit;cursor:pointer;opacity:0.7;padding:0;">✕</button>
    </span>
  `;
}

function clearPendingCommsAttachment() {
  pendingCommsAttachment = null;
  renderPendingCommsAttachment();
}

// ── Request Signature (quick action) ────────────────────────────────────
// Real requests now (POST /api/v1/signatures — server/services/signatureService.js),
// replacing the formerly-disabled "Coming soon" button. The document picker
// is scoped to the active conversation's case, same as Attach's upload
// scoping above; a conversation with no linked case can't request a
// signature (nothing to pick from) — same limitation Attach already has
// implicitly (it just uploads firm-wide instead of failing outright, but a
// signature request needs a real, already-uploaded document to point at).
async function openSignatureRequestModal() {
  const conv = CONVERSATIONS.find(c => c.id === activeConvId);
  if (!conv) return showToast('Select a conversation first.', 'error');
  if (!conv.caseId) return showToast('This conversation has no linked case to pick a document from.', 'error');

  $('signatureRequestForm').reset();
  const select = $('signatureRequestDocument');
  select.innerHTML = '<option value="">Loading documents…</option>';

  const modal = $('signatureRequestModal');
  modal.dataset.caseId = conv.caseId;
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);

  try {
    const { ok, json } = await ApiClient.get(`/api/v1/cases/${conv.caseId}/documents`);
    if (!ok) throw new Error(json.error || 'Failed to load documents.');
    const docs = json.data || [];
    select.innerHTML = docs.length
      ? docs.map(d => `<option value="${d.id}">${d.original_name}</option>`).join('')
      : '<option value="">No documents on this case yet</option>';
  } catch (err) {
    select.innerHTML = '<option value="">Failed to load documents</option>';
    showToast(err.message || 'Failed to load documents.', 'error');
  }
}

function closeSignatureRequestModal() {
  const modal = $('signatureRequestModal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.classList.add('hidden'), 300);
    $('signatureRequestForm').reset();
  }
}

async function handleSignatureRequestSubmit(e) {
  e.preventDefault();
  const modal = $('signatureRequestModal');
  const caseId = modal.dataset.caseId;
  const documentId = $('signatureRequestDocument').value;
  const signerName = $('signatureRequestSignerName').value.trim();
  const signerEmail = $('signatureRequestSignerEmail').value.trim();

  if (!documentId) return showToast('Choose a document to send for signature.', 'error');

  const submitBtn = $('signatureRequestSubmitBtn');
  submitBtn.disabled = true;
  try {
    const { ok, json } = await ApiClient.post('/api/v1/signatures', { caseId, documentId, signerName, signerEmail });
    if (!ok) throw new Error(json.error || 'Failed to create signature request.');

    closeSignatureRequestModal();
    $('signatureLinkSignerName').textContent = signerName;
    $('signatureLinkValue').value = `${window.location.origin}${json.data.sign_path}`;
    const linkModal = $('signatureLinkModal');
    linkModal.classList.remove('hidden');
    setTimeout(() => linkModal.classList.add('active'), 10);

    showToast('Signature request created.', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to create signature request.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
}

function closeSignatureLinkModal() {
  const modal = $('signatureLinkModal');
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => modal.classList.add('hidden'), 300);
  }
}

// ── Template (quick action) ───────────────────────────────────────────────
// Plain string substitution only, per this task's scope — no dynamic
// merge fields (client name, case number, etc.).
const COMMS_MESSAGE_TEMPLATES = [
  { label: 'Case update', text: 'Hi, I wanted to share a quick update on your case. ' },
  { label: 'Document request', text: 'Hi, could you please provide the following document(s) at your earliest convenience: ' },
  { label: 'Hearing reminder', text: 'Hi, this is a reminder that your upcoming hearing is scheduled soon — please reach out if you have any questions preparing for it.' }
];

let commsTemplateMenuEl = null;

function toggleCommsTemplateMenu(anchorBtn) {
  if (commsTemplateMenuEl) { closeCommsTemplateMenu(); return; }

  const menu = document.createElement('div');
  menu.style.cssText = `
    position:absolute; z-index:1000; background:var(--navy-700); color:#fff;
    border:1px solid rgba(255,255,255,0.1); border-radius:8px;
    box-shadow:0 8px 24px rgba(0,0,0,0.4); min-width:190px; padding:4px; font-size:13px;
  `;
  menu.innerHTML = COMMS_MESSAGE_TEMPLATES.map((t, i) =>
    `<div class="comms-template-item" data-index="${i}" style="padding:8px 10px; border-radius:6px; cursor:pointer;">${t.label}</div>`
  ).join('');
  document.body.appendChild(menu);
  commsTemplateMenuEl = menu;

  const rect = anchorBtn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${rect.left + window.scrollX}px`;

  menu.querySelectorAll('.comms-template-item').forEach(item => {
    item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.08)'; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; });
    item.addEventListener('click', () => {
      insertCommsTemplate(COMMS_MESSAGE_TEMPLATES[Number(item.dataset.index)].text);
      closeCommsTemplateMenu();
    });
  });

  // Deferred so the click that just opened the menu doesn't immediately
  // bubble into this listener and close it again.
  setTimeout(() => document.addEventListener('click', handleCommsTemplateOutsideClick), 0);
}

function handleCommsTemplateOutsideClick(e) {
  if (commsTemplateMenuEl && !commsTemplateMenuEl.contains(e.target)) closeCommsTemplateMenu();
}

function closeCommsTemplateMenu() {
  if (commsTemplateMenuEl) {
    commsTemplateMenuEl.remove();
    commsTemplateMenuEl = null;
  }
  document.removeEventListener('click', handleCommsTemplateOutsideClick);
}

function insertCommsTemplate(text) {
  const textarea = $('commsMessageInput');
  textarea.value = textarea.value ? `${textarea.value}\n${text}` : text;
  textarea.dispatchEvent(new Event('input'));
  textarea.focus();
}

/* ════════════════════════════════════════════
   SETTINGS / TEAM MEMBERS — ADMIN-INVITE USER PROVISIONING
   The only way to add a user used to be running `npm run seed` with a new
   hardcoded entry — this talks to a real, ADMIN-gated backend
   (server/services/inviteService.js): GET /api/v1/admin/users (roster) and
   POST /api/v1/admin/invites (create a placeholder user + one-time invite
   link). The admin never sets the invitee's password — only the invitee
   does, by visiting accept-invite.html with the returned link.
   ════════════════════════════════════════════ */

let settingsListenersInitialized = false;
let settingsActiveTab = 'team';

function initSettingsPage() {
  const isAdmin = Auth.getUser() && Auth.getUser().role === 'ADMIN';
  $('inviteUserBtn').classList.toggle('hidden', !isAdmin);
  $('settingsNonAdminNotice').classList.toggle('hidden', isAdmin);
  $('settingsAuditTabBtn').classList.toggle('hidden', !isAdmin);
  $('settingsStorageTabBtn').classList.toggle('hidden', !isAdmin);

  setupSettingsPageListeners();
  setSettingsTab(isAdmin ? settingsActiveTab : 'team');
  loadTeam();
}

function setSettingsTab(tab) {
  settingsActiveTab = tab;
  $$('[data-settings-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.settingsTab === tab);
  });
  $('settingsTeamTab').classList.toggle('hidden', tab !== 'team');
  $('settingsAuditTab').classList.toggle('hidden', tab !== 'audit');
  $('settingsStorageTab').classList.toggle('hidden', tab !== 'storage');

  if (tab === 'audit' && !AuditLogState.filterOptionsLoaded) {
    loadAuditLogFilterOptions();
  }
  if (tab === 'audit') loadAuditLog();
  if (tab === 'storage') loadStorageQuota();
}

async function loadTeam() {
  const tbody = $('teamTableBody');
  if (!tbody) return;

  // The roster is ADMIN-only and enforced server-side (requireRole('ADMIN')
  // on GET /api/v1/admin/users), not just by the hidden invite button
  // above. A non-ADMIN used to call it anyway and rely on the catch below
  // to render the explanatory row — which worked, but spent a round trip
  // to be told something already known and logged a permanent 403 in the
  // browser console, where it sat masking real errors. The server-side
  // check is still the one that matters; this just stops asking a
  // question whose answer is already in hand.
  if (!Auth.getUser() || Auth.getUser().role !== 'ADMIN') {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--slate-400)">Only firm administrators can view the team roster.</td></tr>`;
    return;
  }

  try {
    const team = await ApiClient.get('/api/v1/admin/users');
    renderTeamTable(team);
  } catch (err) {
    // Only an ADMIN reaches this now, so a failure here is a real error
    // rather than the expected permission refusal it used to also cover.
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--slate-400)">Error loading team roster</td></tr>`;
  }
}

function renderTeamTable(team) {
  const tbody = $('teamTableBody');
  const statusLabels = { active: 'Active', pending: 'Invite Pending', expired: 'Invite Expired' };
  const statusClass = { active: 'active', pending: 'pending', expired: 'closed' };

  if (!team.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--slate-400)">No team members yet</td></tr>`;
    return;
  }

  tbody.innerHTML = team.map(u => `
    <tr>
      <td>${escapeHtml(u.full_name)}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.role)}</td>
      <td><span class="status-badge ${statusClass[u.invite_status] || 'active'}">${statusLabels[u.invite_status] || u.invite_status}</span></td>
      <td class="activity-time">${new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
    </tr>
  `).join('');
}

function setupSettingsPageListeners() {
  if (settingsListenersInitialized) return;

  $('inviteUserBtn').addEventListener('click', () => {
    $('inviteResultBox').classList.add('hidden');
    $('inviteUserForm').reset();
    $('inviteUserModal').classList.remove('hidden');
  });

  const closeInviteModal = () => $('inviteUserModal').classList.add('hidden');
  $('inviteModalCloseBtn').addEventListener('click', closeInviteModal);
  $('inviteModalCancelBtn').addEventListener('click', closeInviteModal);
  $('inviteUserModal').addEventListener('click', (e) => {
    if (e.target === $('inviteUserModal')) closeInviteModal();
  });

  $$('[data-settings-tab]').forEach(btn => {
    btn.addEventListener('click', () => setSettingsTab(btn.dataset.settingsTab));
  });

  ['auditFilterUser', 'auditFilterAction', 'auditFilterFrom', 'auditFilterTo'].forEach(id => {
    $(id).addEventListener('change', () => {
      AuditLogState.page = 1;
      loadAuditLog();
    });
  });
  $('auditFilterClearBtn').addEventListener('click', () => {
    $('auditFilterUser').value = '';
    $('auditFilterAction').value = '';
    $('auditFilterFrom').value = '';
    $('auditFilterTo').value = '';
    AuditLogState.page = 1;
    loadAuditLog();
  });
  $('auditLogPrevPage').addEventListener('click', () => {
    if (AuditLogState.page > 1) {
      AuditLogState.page--;
      loadAuditLog();
    }
  });
  $('auditLogNextPage').addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(AuditLogState.total / AuditLogState.pageSize));
    if (AuditLogState.page < totalPages) {
      AuditLogState.page++;
      loadAuditLog();
    }
  });

  $('storageQuotaForm').addEventListener('submit', handleStorageQuotaSubmit);

  settingsListenersInitialized = true;
}

async function handleInviteUserSubmit(event) {
  event.preventDefault();
  const fullName = $('inviteFullName').value;
  const initials = $('inviteInitials').value;
  const email = $('inviteEmail').value;
  const role = $('inviteRole').value;

  const submitBtn = $('inviteSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';

  try {
    const { ok, json } = await ApiClient.post('/api/v1/admin/invites', { fullName, initials, email, role });
    if (!ok) throw new Error(json.error || 'Failed to create invite.');

    // No email/SMTP is configured in this project (see .env.local) — the
    // link is shown here, once, for the admin to relay however they
    // currently communicate with new hires, rather than silently
    // pretending an email was sent.
    const fullUrl = `${window.location.origin}${json.data.invite_path}`;
    const box = $('inviteResultBox');
    box.innerHTML = `<strong>${json.data.user.full_name}</strong> was created. Send them this one-time link (expires ${new Date(json.data.expires_at).toLocaleDateString()}):<br><br>${fullUrl}`;
    box.classList.remove('hidden');

    showToast(`Invite created for ${json.data.user.full_name}.`, 'success');
    loadTeam();
  } catch (err) {
    showToast(err.message || 'Failed to create invite.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Invite';
  }
}

/* ════════════════════════════════════════════
   SETTINGS / AUDIT LOG — GET /api/v1/admin/audit-logs
   Every audit_logs row was already being written (logAuditAction
   middleware for document actions, direct db.insertAuditLog calls for
   case/invoice/invite/quota writes) — this is the first UI that reads any
   of it back out. Paginated and filtered server-side (user/action/date),
   not fetched-all-then-sliced client-side like the Billing page, since
   this table can grow unbounded rather than staying a small seeded list.
   ════════════════════════════════════════════ */

// Must stay in step with the audit_action enum in Postgres (db/schema.sql
// plus every migration that ALTERs it). This list had drifted: the trust
// ledger, conflict checks, matter intake, document versions and
// e-signature actions were all writing audit rows that the filter dropdown
// could not select, so those entries were invisible to anyone filtering by
// action. Verified against `SELECT unnest(enum_range(NULL::audit_action))`.
const AUDIT_ACTIONS = [
  // Documents
  'UPLOAD', 'UPLOAD_VERSION', 'VIEW', 'PREVIEW', 'DOWNLOAD', 'SHARE',
  'UPDATE_METADATA', 'DELETE', 'FLAG', 'UNFLAG', 'CREATE_FOLDER',
  // AI Copilot
  'COPILOT_MOVE', 'COPILOT_RENAME', 'COPILOT_TAG', 'COPILOT_DELETE',
  'COPILOT_UPDATE_CASE', 'COPILOT_CREATE_CASE',
  // Cases and matter intake
  'CREATE_CASE', 'ARCHIVE_CASE', 'CASE_ACTIVATED', 'CASE_INTAKE_STARTED',
  'CASE_INTAKE_CONFLICT_HOLD', 'CASE_INTAKE_CONFLICT_OVERRIDE',
  'CASE_INTAKE_ENGAGEMENT_LETTER_SENT', 'CASE_INTAKE_ENGAGEMENT_LETTER_UPLOADED',
  'CASE_INTAKE_SIGNED', 'CASE_INTAKE_RETAINER_LINKED',
  'CASE_INTAKE_RETAINER_WAIVED', 'CASE_INTAKE_DECLINED',
  'CONFLICT_CHECK_HIT', 'CONFLICT_CHECK_CLEAR', 'CONFLICT_CHECK_OVERRIDE',
  // Billing
  'CREATE_INVOICE', 'UPDATE_INVOICE', 'MARK_INVOICE_PAID',
  // Trust accounting
  'TRUST_DEPOSIT', 'TRUST_DISBURSEMENT', 'TRUST_TRANSFER_TO_OPERATING',
  'TRUST_ADJUSTMENT', 'TRUST_RECONCILE',
  // E-signature
  'CREATE_SIGNATURE_REQUEST', 'COMPLETE_SIGNATURE_REQUEST', 'VOID_SIGNATURE_REQUEST',
  // Users and sessions
  'CREATE_USER_INVITE', 'LOGOUT', 'REVOKE_SESSIONS', 'UPDATE_STORAGE_QUOTA'
];

const AuditLogState = { page: 1, pageSize: 20, total: 0, filterOptionsLoaded: false };

function formatAuditAction(action) {
  return String(action || '').split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

async function loadAuditLogFilterOptions() {
  $('auditFilterAction').innerHTML = '<option value="">All Actions</option>' +
    AUDIT_ACTIONS.map(a => `<option value="${a}">${formatAuditAction(a)}</option>`).join('');

  try {
    // Reuses the same roster endpoint the Team Members tab already calls —
    // no new backend route needed just to populate a "filter by user" list.
    const team = await ApiClient.get('/api/v1/admin/users');
    $('auditFilterUser').innerHTML = '<option value="">All Users</option>' +
      team.map(u => `<option value="${escapeAttr(u.id)}">${escapeHtml(u.full_name)}</option>`).join('');
  } catch (err) {
    // Non-fatal — the table still loads unfiltered, just without a user dropdown.
  }

  AuditLogState.filterOptionsLoaded = true;
}

async function loadAuditLog() {
  const tbody = $('auditLogTableBody');
  if (!tbody) return;

  const params = new URLSearchParams();
  params.set('page', AuditLogState.page);
  params.set('page_size', AuditLogState.pageSize);
  const userId = $('auditFilterUser').value;
  const action = $('auditFilterAction').value;
  const dateFrom = $('auditFilterFrom').value;
  const dateTo = $('auditFilterTo').value;
  if (userId) params.set('user_id', userId);
  if (action) params.set('action', action);
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--slate-400)">Loading…</td></tr>`;

  try {
    // A non-ADMIN gets a 403 here — expected, not an error state, same as loadTeam().
    const data = await ApiClient.get(`/api/v1/admin/audit-logs?${params.toString()}`);
    AuditLogState.total = data.total;
    AuditLogState.page = data.page;
    AuditLogState.pageSize = data.page_size;
    renderAuditLogTable(data.logs);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--slate-400)">${Auth.getUser() && Auth.getUser().role === 'ADMIN' ? 'Error loading audit log' : 'Only firm administrators can view the audit log.'}</td></tr>`;
    $('auditLogShowingText').textContent = 'Showing 0 of 0';
    $('auditLogPrevPage').disabled = true;
    $('auditLogNextPage').disabled = true;
    $('auditLogPageNumbers').innerHTML = '';
  }
}

// document_name covers document-scoped actions (UPLOAD/DELETE/COPILOT_*);
// everything else (case/invoice/invite/quota writes) stores its own
// reference in `details` instead, since audit_logs has no case_id/
// invoice_id column of its own — same reasoning as db.listActivityForCase.
function auditLogTargetLabel(log) {
  if (log.document_name) return log.document_name;
  const d = log.details || {};
  return d.case_id || d.invoice_number || d.email || '—';
}

function renderAuditLogTable(logs) {
  const tbody = $('auditLogTableBody');

  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--slate-400)">No audit log entries match these filters</td></tr>`;
  } else {
    tbody.innerHTML = logs.map(log => `
      <tr>
        <td class="activity-time">${new Date(log.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
        <td>${escapeHtml(log.user_name) || 'System'}</td>
        <td>${formatAuditAction(log.action)}</td>
        <td>${escapeHtml(auditLogTargetLabel(log))}</td>
        <td class="activity-time">${log.ip_address || '—'}</td>
      </tr>
    `).join('');
  }

  const { page, pageSize, total } = AuditLogState;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  $('auditLogShowingText').textContent = total === 0 ? 'Showing 0 of 0' : `Showing ${start}–${end} of ${total}`;
  $('auditLogPrevPage').disabled = page <= 1;
  $('auditLogNextPage').disabled = page >= totalPages;

  let pageNumbersHtml = '';
  for (let i = 1; i <= totalPages; i++) {
    pageNumbersHtml += `<button class="page-btn ${page === i ? 'active' : ''}" data-action="set-audit-log-page" data-page-number="${i}">${i}</button>`;
  }
  $('auditLogPageNumbers').innerHTML = pageNumbersHtml;
}

function setAuditLogPage(p) {
  AuditLogState.page = p;
  loadAuditLog();
}

/* ════════════════════════════════════════════
   SETTINGS / STORAGE QUOTA — GET/PATCH /api/v1/admin/storage-quota
   Quota is per-firm (server/services/storageQuotaService.js — the
   storage_quotas table is keyed on firm_id alone, matching this app's
   single-firm-per-deployment model, so there is no per-user breakdown to
   show). Surfaces the same limit server/middleware/storageQuota.js
   already enforces on every upload, and lets an ADMIN change it.
   ════════════════════════════════════════════ */

function bytesToGB(bytes) {
  return bytes / (1024 * 1024 * 1024);
}

async function loadStorageQuota() {
  try {
    const quota = await ApiClient.get('/api/v1/admin/storage-quota');
    const usedGB = bytesToGB(quota.storage_used_bytes);
    const limitGB = bytesToGB(quota.storage_limit_bytes);
    const pct = quota.storage_limit_bytes > 0
      ? Math.min(100, Math.round((quota.storage_used_bytes / quota.storage_limit_bytes) * 100))
      : 0;

    $('storageUsedText').textContent = `${usedGB.toFixed(1)}GB / ${limitGB.toFixed(1)}GB used`;
    $('storagePctText').textContent = `${pct}%`;
    $('storageAdminBar').style.width = `${pct}%`;
    $('storageQuotaLimitInput').value = Math.round(limitGB);
  } catch (err) {
    showToast(err.message || 'Failed to load storage quota.', 'error');
  }
}

async function handleStorageQuotaSubmit(event) {
  event.preventDefault();
  const gb = parseInt($('storageQuotaLimitInput').value, 10);
  if (!Number.isInteger(gb) || gb < 1) {
    showToast('Enter a whole number of GB (at least 1).', 'error');
    return;
  }

  const submitBtn = $('storageQuotaSaveBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';

  try {
    await ApiClient.patch('/api/v1/admin/storage-quota', { storage_limit_bytes: gb * 1024 * 1024 * 1024 });
    showToast('Storage quota updated.', 'success');
    loadStorageQuota();
  } catch (err) {
    showToast(err.message || 'Failed to update storage quota.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Limit';
  }
}

/* ════════════════════════════════════════════
   DOCUMENT VAULT FULL INTERACTIVITY
   ════════════════════════════════════════════ */

const VaultState = {
  activeTab: 'Case Files',
  selectedFolderId: null,
  searchQuery: '',
  caseFilter: '',
  typeFilter: '',
  tagFilter: '',
  sortCol: 'updated_at',
  sortDir: 'desc',
  selectedDocIds: new Set(),
  currentPage: 1,
  pageSize: 10,
  isLoading: false,
  totalItems: 0,
  stats: null,
  tree: null,
  docs: []
};

// Orchestrator
async function initDocumentVault() {
  setupVaultEventListeners();
  await Promise.all([
    loadVaultStats(),
    loadVaultTree(),
    loadSidebarWidgets(),
    loadVaultCaseFilterOptions(),
    loadVaultTagFilterOptions()
  ]);
  await loadVaultFiles();
}

// The Case filter reuses whatever CASES the Cases page already fetched
// (same shape: {id, name}) rather than a second endpoint — fetch it only
// if nothing has loaded it yet (e.g. Vault opened before Cases).
async function loadVaultCaseFilterOptions() {
  try {
    if (!CASES.length) await loadCases();
    const select = $('vaultCaseFilter');
    const current = select.value;
    select.innerHTML = `<option value="">All Cases</option>` +
      CASES.map(c => `<option value="${escapeAttr(c.id)}">${escapeHtml(c.id)} — ${escapeHtml(c.name)}</option>`).join('');
    select.value = current;
  } catch (err) {
    console.error('Case filter options load error', err);
  }
}

async function loadVaultTagFilterOptions() {
  try {
    const tags = await ApiClient.get('/api/v1/vault/tags');
    const select = $('vaultTagFilter');
    const current = select.value;
    select.innerHTML = `<option value="">All Tags</option>` +
      tags.map(t => `<option value="${t.replace(/"/g, '&quot;')}">${t}</option>`).join('');
    select.value = current;
  } catch (err) {
    console.error('Tag filter options load error', err);
  }
}

// API Wrapper
// Every call attaches the signed-in user's bearer token (see the Auth
// module above). A 401 means the token is missing/expired/invalid — the
// user is dropped back to the login screen rather than the app silently
// operating as no one / the wrong tenant.
const ApiClient = {
  async get(url) {
    const res = await fetch(url, { headers: { ...Auth.authHeader() } });
    if (res.status === 401) { handleUnauthenticated(); throw new Error('Not signed in.'); }
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API Error');
    return json.data;
  },
  async post(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...Auth.authHeader() },
      body: JSON.stringify(data)
    });
    if (res.status === 401) { handleUnauthenticated(); throw new Error('Not signed in.'); }
    const json = await res.json();
    // 413 (storage quota) and 409 (e.g. a conflict-check hit on case
    // create — see CaseService.createCase) carry structured detail the
    // caller needs to act on, not just an error string — let those through
    // instead of throwing so callers can inspect `json`/`status` directly.
    if (!json.success && res.status !== 413 && res.status !== 409) throw new Error(json.error || 'API Error');
    return { ok: res.ok, status: res.status, json };
  },
  async patch(url, data) {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...Auth.authHeader() },
      body: JSON.stringify(data)
    });
    if (res.status === 401) { handleUnauthenticated(); throw new Error('Not signed in.'); }
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API Error');
    return json;
  },
  // Multipart upload — deliberately does NOT set a Content-Type header so
  // the browser can add the multipart boundary itself; only the auth
  // header is attached.
  async postForm(url, formData) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...Auth.authHeader() },
      body: formData
    });
    if (res.status === 401) { handleUnauthenticated(); throw new Error('Not signed in.'); }
    const json = await res.json();
    // 413 (storage quota) and 409 (DUPLICATE_CONTENT — see
    // VaultService.initiateUpload) carry structured detail the caller
    // needs to act on (e.g. an "upload anyway?" prompt), not just an
    // error string — let those through instead of throwing.
    if (!json.success && res.status !== 413 && res.status !== 409) throw new Error(json.error || 'API Error');
    return { ok: res.ok, status: res.status, json };
  },
  async del(url) {
    const res = await fetch(url, { method: 'DELETE', headers: { ...Auth.authHeader() } });
    if (res.status === 401) { handleUnauthenticated(); throw new Error('Not signed in.'); }
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API Error');
    return json;
  }
};

// ── UI RENDERERS ──

async function loadVaultStats() {
  try {
    const data = await ApiClient.get('/api/v1/vault/stats');
    VaultState.stats = data;
    $('kpiValDocs').textContent = data.total_documents_count.toLocaleString();
    $('kpiValDocs').classList.remove('skeleton-text');
    
    $('kpiValStorage').innerHTML = `${data.storage_used_formatted} <span class="kpi-sub-val">/ ${data.storage_limit_formatted}</span>`;
    const pct = Math.round((data.storage_used_bytes / data.storage_limit_bytes) * 100);
    $('kpiStorageBar').style.width = `${pct}%`;
    $('kpiStorageSub').textContent = `${data.storage_used_formatted} / ${data.storage_limit_formatted}`;
    
    $('kpiValUploads').textContent = data.recent_uploads_count;
    $('kpiValFlagged').textContent = data.flagged_for_review_count;
  } catch (err) {
    console.error('Stats load error', err);
  }
}

async function loadVaultTree() {
  try {
    const data = await ApiClient.get('/api/v1/vault/tree');
    VaultState.tree = data;
    renderVaultTree();
  } catch (err) {
    console.error('Tree load error', err);
  }
}

function renderVaultTree() {
  const container = $('vaultFolderTree');
  if (!VaultState.tree) return;
  
  // The tree is navigation ONLY — it used to also render every file inside
  // every folder inline (node.files), which meant the same documents
  // appeared twice: once as tree leaves here, once in the table on the
  // right (see vaultTableBody / renderVaultTable). Clicking a folder here
  // already drives the table via selectFolder -> loadVaultFiles, so the
  // file list itself belongs in exactly one place.
  function buildHtml(nodes, level = 0) {
    return nodes.map(node => {
      const isSelected = VaultState.selectedFolderId === node.id;
      const hasChildren = node.subfolders && node.subfolders.length;
      const subHtml = hasChildren ? `<div class="tree-children" style="padding-left:14px; display:block;">${buildHtml(node.subfolders, level + 1)}</div>` : '';
      const fileCount = node.files ? node.files.length : 0;

      return `
        <div class="tree-item ${isSelected ? 'active-item' : ''}" data-action="select-folder" data-folder-id="${escapeAttr(node.id)}" data-folder-name="${escapeAttr(node.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="arrow-icon" style="transform: ${hasChildren ? 'rotate(90deg)' : 'rotate(0)'}; opacity: ${hasChildren ? 1 : 0};"><path d="M9 18l6-6-6-6"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="${isSelected ? '#2DC8B0' : '#8A99AD'}" ${isSelected ? 'fill="rgba(45,200,176,0.2)"' : ''} stroke-width="2" class="folder-icon"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <span class="tree-label ${isSelected ? 'green-label' : ''}">${escapeHtml(node.name)}</span>
          ${fileCount ? `<span class="tree-file-count">${fileCount}</span>` : ''}
        </div>
        ${subHtml}
      `;
    }).join('');
  }
  
  container.innerHTML = buildHtml(VaultState.tree);
}

function selectFolder(folderId, folderName) {
  VaultState.selectedFolderId = folderId;
  VaultState.currentPage = 1;
  $('vaultBreadcrumb').innerHTML = `
    <span class="breadcrumb-item" data-action="reset-folder">${VaultState.activeTab}</span>
    <span class="breadcrumb-sep">/</span>
    <span class="breadcrumb-item active">${folderName}</span>
  `;
  renderVaultTree();
  loadVaultFiles();
}

function resetFolder() {
  VaultState.selectedFolderId = null;
  VaultState.currentPage = 1;
  $('vaultBreadcrumb').innerHTML = `<span class="breadcrumb-item active">${VaultState.activeTab}</span>`;
  renderVaultTree();
  loadVaultFiles();
}

async function loadVaultFiles() {
  VaultState.isLoading = true;
  renderVaultTableSkeleton();
  updateUrlState();
  
  try {
    const params = new URLSearchParams({
      tab_category: VaultState.activeTab,
      page: VaultState.currentPage,
      limit: VaultState.pageSize,
      sort: VaultState.sortCol,
      order: VaultState.sortDir
    });
    if (VaultState.selectedFolderId) params.append('folder_id', VaultState.selectedFolderId);
    if (VaultState.searchQuery) params.append('q', VaultState.searchQuery);
    if (VaultState.caseFilter) params.append('case_id', VaultState.caseFilter);
    if (VaultState.typeFilter) params.append('extension', VaultState.typeFilter);
    if (VaultState.tagFilter) params.append('tag', VaultState.tagFilter);
    
    const res = await fetch(`/api/v1/vault/files?${params}`, { headers: { ...Auth.authHeader() } });
    if (res.status === 401) { handleUnauthenticated(); return; }
    const json = await res.json();
    if (json.success) {
      VaultState.docs = json.data;
      VaultState.totalItems = json.pagination.total;
      VaultState.selectedDocIds.clear();
      updateBulkActionBar();
      renderVaultTable();
    }
  } catch (err) {
    console.error('Files load error', err);
    $('vaultTableBody').innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--slate-400)">Error loading files</td></tr>`;
  } finally {
    VaultState.isLoading = false;
  }
}

function renderVaultTableSkeleton() {
  $('vaultTableBody').innerHTML = Array(5).fill(`
    <tr class="skeleton-row">
      <td class="col-chk"><input type="checkbox" disabled /></td>
      <td colspan="7"><div class="sk-cell" style="width: 100%"></div></td>
    </tr>
  `).join('');
}

function renderVaultTable() {
  const tbody = $('vaultTableBody');
  if (!VaultState.docs.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--slate-400)">No documents found</td></tr>`;
    $('vaultPagination').innerHTML = '';
    return;
  }
  
  tbody.innerHTML = VaultState.docs.map(doc => {
    const isChecked = VaultState.selectedDocIds.has(doc.id);
    const dateStr = new Date(doc.updated_at).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    const sizeMb = (doc.file_size_bytes / (1024*1024)).toFixed(1) + ' MB';
    
    const iconColors = { pdf: 'pdf', docx: 'word', doc: 'word', xlsx: 'excel' };
    const badgeCls = iconColors[doc.extension] || 'word';
    const badgeText = doc.extension.toUpperCase();
    
    const tagsHtml = (doc.tags || []).map(t => {
      let tCls = 'retainer';
      if (t === 'CONFIDENTIAL') tCls = 'confidential';
      if (t === 'COURT FILING') tCls = 'court-filing';
      if (t === 'EVIDENCE') tCls = 'EVIDENCE';
      return `<span class="tag-badge ${tCls}">${escapeHtml(t)}</span>`;
    }).join('');

    return `
      <tr style="${doc.is_flagged ? 'border-left: 3px solid #E74C3C;' : ''}">
        <td class="col-chk"><input type="checkbox" value="${doc.id}" class="row-chk" ${isChecked ? 'checked' : ''} /></td>
        <td class="col-name" data-action="preview-document" data-document-id="${escapeAttr(doc.id)}" style="cursor:pointer">
          <div class="file-cell">
            <span class="file-icon-badge ${badgeCls}">${badgeText}</span>
            <span class="file-name-text">${escapeHtml(doc.file_name)}</span>
          </div>
        </td>
        <td class="col-case">${doc.case_id
          ? `<a href="#" class="case-name-link" data-action="open-case-detail" data-stop-propagation="true" data-case-id="${escapeAttr(doc.case_id)}" data-case-name="${escapeAttr(doc.case_name || '')}">${escapeHtml(doc.case_name || doc.case_id)}</a>`
          : '—'}</td>
        <td class="col-author">${escapeHtml(doc.author_name)}</td>
        <td class="col-date">${dateStr}</td>
        <td class="col-size">${sizeMb}</td>
        <td class="col-tags">${tagsHtml}</td>
        <td class="col-action" style="position:relative">
          <button class="doc-action-btn" data-action="open-context-menu" data-document-id="${escapeAttr(doc.id)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
  
  // Row Checkboxes
  $$('.row-chk').forEach(chk => {
    chk.addEventListener('change', (e) => {
      if (e.target.checked) VaultState.selectedDocIds.add(e.target.value);
      else VaultState.selectedDocIds.delete(e.target.value);
      updateBulkActionBar();
    });
  });

  // Select All Checkbox
  $('vaultSelectAll').checked = VaultState.selectedDocIds.size === VaultState.docs.length && VaultState.docs.length > 0;
  
  renderPagination();
}

function renderPagination() {
  const totalPages = Math.ceil(VaultState.totalItems / VaultState.pageSize);
  let html = `<span>Showing ${(VaultState.currentPage-1)*VaultState.pageSize + 1} to ${Math.min(VaultState.currentPage*VaultState.pageSize, VaultState.totalItems)} of ${VaultState.totalItems} files</span>`;
  html += `<div class="vault-pagination-btns">`;
  html += `<button class="page-btn" ${VaultState.currentPage === 1 ? 'disabled' : ''} data-action="vault-page-prev">&lt;</button>`;
  html += `<button class="page-btn" ${VaultState.currentPage >= totalPages ? 'disabled' : ''} data-action="vault-page-next">&gt;</button>`;
  html += `</div>`;
  $('vaultPagination').innerHTML = html;
}

// ── EVENT LISTENERS ──

function setupVaultEventListeners() {
  // Tabs
  $$('.vault-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.vault-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      VaultState.activeTab = btn.dataset.tab;
      resetFolder();
    });
  });

  // Search (Debounced)
  let searchTimeout;
  $('vaultSearchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      VaultState.searchQuery = e.target.value;
      VaultState.currentPage = 1;
      loadVaultFiles();
    }, 300);
  });

  // Filters (Case / File Type / Tag)
  $('vaultCaseFilter').addEventListener('change', (e) => {
    VaultState.caseFilter = e.target.value;
    VaultState.currentPage = 1;
    loadVaultFiles();
  });
  $('vaultTypeFilter').addEventListener('change', (e) => {
    VaultState.typeFilter = e.target.value;
    VaultState.currentPage = 1;
    loadVaultFiles();
  });
  $('vaultTagFilter').addEventListener('change', (e) => {
    VaultState.tagFilter = e.target.value;
    VaultState.currentPage = 1;
    loadVaultFiles();
  });

  // Sorting
  $$('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (VaultState.sortCol === col) {
        VaultState.sortDir = VaultState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        VaultState.sortCol = col;
        VaultState.sortDir = 'desc';
      }
      $$('.sortable').forEach(el => el.classList.remove('asc', 'desc'));
      th.classList.add(VaultState.sortDir);
      loadVaultFiles();
    });
  });

  // Select All
  $('vaultSelectAll').addEventListener('change', (e) => {
    if (e.target.checked) {
      VaultState.docs.forEach(d => VaultState.selectedDocIds.add(d.id));
    } else {
      VaultState.selectedDocIds.clear();
    }
    $$('.row-chk').forEach(chk => chk.checked = e.target.checked);
    updateBulkActionBar();
  });

  // Modals
  $('btnNewFolder').addEventListener('click', () => openVaultModal('newFolderModal'));
  // NOT `addEventListener('click', openUploadModal)` — that would call
  // openUploadModal(clickEvent), and openUploadModal's first parameter is
  // an optional case id (see its own doc comment above), not an event. A
  // truthy PointerEvent there used to become VaultState.presetCaseId,
  // which formData.append then stringified to the literal text
  // "[object PointerEvent]" and db.ensureCase persisted as a real case
  // row (both its id and case_name) on every plain "Upload Files" click.
  $('btnUploadFiles').addEventListener('click', () => openUploadModal());
  $('btnIntegrations').addEventListener('click', () => {
    $('integrationsDrawerOverlay').classList.remove('hidden');
  });
  setupDocumentDetailListeners();

  // Context Menu Global Click away
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.doc-action-btn') && !e.target.closest('#vaultContextMenu')) {
      $('vaultContextMenu').classList.add('hidden');
    }
  });

  // Bulk Actions
  $('bulkCancel').addEventListener('click', () => {
    VaultState.selectedDocIds.clear();
    $$('.row-chk').forEach(c => c.checked = false);
    $('vaultSelectAll').checked = false;
    updateBulkActionBar();
  });
  $('bulkDelete').addEventListener('click', async () => {
    if (confirm(`Delete ${VaultState.selectedDocIds.size} files?`)) {
      for (const id of VaultState.selectedDocIds) {
        await ApiClient.del(`/api/v1/files/${id}`);
      }
      showToast(`${VaultState.selectedDocIds.size} files deleted`, 'success');
      VaultState.selectedDocIds.clear();
      loadVaultFiles();
      loadVaultStats();
    }
  });
  
  // Date dropdown
  $('vaultDateBtn').addEventListener('click', () => {
    $('vaultDateDropdown').classList.toggle('hidden');
  });

  // New Folder Submit
  $('newFolderSubmit').addEventListener('click', async () => {
    const name = $('newFolderName').value.trim();
    if (!name) return;
    try {
      await ApiClient.post('/api/v1/vault/folders', {
        folder_name: name,
        category: $('newFolderCategory').value,
        parent_id: $('newFolderParent').value || null
      });
      showToast(`Folder ${name} created`, 'success');
      closeVaultModal('newFolderModal');
      loadVaultTree();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });

  initDragAndDrop();
}

// ── CONTEXT MENU ──
let currentCtxDocId = null;
function openContextMenu(e, docId) {
  e.stopPropagation();
  currentCtxDocId = docId;
  const menu = $('vaultContextMenu');
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  
  menu.style.top = (rect.bottom + window.scrollY + 5) + 'px';
  menu.style.left = (rect.left - 120) + 'px';
  menu.classList.remove('hidden');
  
  const doc = VaultState.docs.find(d => d.id === docId);
  $('ctxFlagLabel').textContent = doc.is_flagged ? 'Unflag File' : 'Flag for Review';
}

// Downloads require the Authorization header, which a plain navigation or
// window.open() cannot attach — the file is fetched as a blob (with auth)
// and then handed to the browser's normal save flow via a temporary link.
async function downloadDocument(docId) {
  try {
    const res = await fetch(`/api/v1/files/${docId}/download`, { headers: { ...Auth.authHeader() } });
    if (res.status === 401) { handleUnauthenticated(); return; }
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      showToast(json.error || 'Download failed.', 'error');
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const filename = match ? decodeURIComponent(match[1]) : 'download';

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (e) {
    showToast('Download failed.', 'error');
  }
}

/* ════════════════════════════════════════════
   DOCUMENT DETAIL / VERSION HISTORY MODAL
   Opened from the vault context menu's "Version History" item. Backed by
   the real document_versions endpoints added alongside this UI
   (GET/POST /api/v1/files/:id/versions, GET
   /api/v1/files/:id/versions/:versionId/download) — re-upload here
   creates a new version instead of overwriting the file, same as every
   other re-upload path in this app. Includes a "Compare versions" line-diff
   view for text-like formats (GET /api/v1/files/:id/versions/:v1/diff/:v2),
   falling back to a side-by-side download for anything not diffable.
   ════════════════════════════════════════════ */

let docDetailCurrentDocId = null;
let docDetailListenersInitialized = false;

// `fileName` is optional — the vault context menu (where VaultState.docs
// is always populated) omits it and relies on the lookup below; the Case
// File modal's document list passes it directly instead, since that
// list's documents aren't necessarily part of VaultState.docs (the vault
// page may never have been visited this session, or this doc may be off
// the vault's current page/filter).
function openDocumentDetailModal(docId, fileName) {
  // Guarded by docDetailListenersInitialized (see setupDocumentDetailListeners
  // itself) — safe to call every time this modal opens, not just from the
  // vault page's own setup, since it can also be opened from the Case File
  // modal without the vault page ever having been visited this session.
  setupDocumentDetailListeners();

  docDetailCurrentDocId = docId;
  const doc = VaultState.docs.find(d => d.id === docId);
  $('docDetailFileName').textContent = fileName || (doc ? doc.file_name : docId);

  $('docDetailNewVersionFile').value = '';
  $('docDetailVersionComment').value = '';
  $('docDetailCommentGroup').classList.add('hidden');
  $('docDetailUploadVersionBtn').disabled = true;
  $('docDetailUploadVersionBtn').textContent = 'Upload New Version';

  const modal = $('documentDetailModal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);

  loadDocumentVersions(docId);
}

function closeDocumentDetailModal() {
  const modal = $('documentDetailModal');
  modal.classList.remove('active');
  setTimeout(() => modal.classList.add('hidden'), 300);
  docDetailCurrentDocId = null;
}

async function loadDocumentVersions(docId) {
  const tbody = $('docDetailVersionsTableBody');
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--slate-400)">Loading…</td></tr>`;
  try {
    const versions = await ApiClient.get(`/api/v1/files/${docId}/versions`);
    renderDocumentVersions(versions);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--slate-400)">Error loading version history</td></tr>`;
  }
}

function renderDocumentVersions(versions) {
  const tbody = $('docDetailVersionsTableBody');
  if (!versions.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--slate-400)">No versions on file.</td></tr>`;
    return;
  }
  tbody.innerHTML = versions.map(v => `
    <tr>
      <td>v${v.version_number}${v.is_current ? ' <span class="status-badge active" style="font-size:10px; padding:1px 6px; margin-left:6px;">Current</span>' : ''}</td>
      <td>${v.uploaded_by_name || '—'}</td>
      <td class="activity-time">${new Date(v.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}</td>
      <td>${v.comment || '—'}</td>
      <td><button class="btn-ghost" style="padding:2px 8px; font-size:12px;" data-action="download-version" data-version-id="${escapeAttr(v.id)}">Download</button></td>
    </tr>
  `).join('');

  populateCompareSelectors(versions);
}

// "Compare versions" entry point on the Version History panel — only shown
// once there are at least two versions to pick between. Defaults to the two
// most recent (versions is newest-first, same order the table above uses).
function populateCompareSelectors(versions) {
  const bar = $('docDetailCompareBar');
  if (versions.length < 2) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  const options = versions.map(v => `<option value="${v.version_number}">v${v.version_number}${v.is_current ? ' (current)' : ''}</option>`).join('');
  const selectA = $('docDetailCompareA');
  const selectB = $('docDetailCompareB');
  selectA.innerHTML = options;
  selectB.innerHTML = options;
  selectA.value = versions[1].version_number; // second-newest
  selectB.value = versions[0].version_number; // newest / current
}

async function handleCompareVersions() {
  const v1 = $('docDetailCompareA').value;
  const v2 = $('docDetailCompareB').value;
  if (!docDetailCurrentDocId || !v1 || !v2) return;

  if (v1 === v2) {
    showToast('Pick two different versions to compare.', 'error');
    return;
  }

  openVersionCompareModal();
  try {
    const data = await ApiClient.get(`/api/v1/files/${docDetailCurrentDocId}/versions/${v1}/diff/${v2}`);
    renderVersionComparison(data);
  } catch (err) {
    $('versionCompareBody').innerHTML = `<p style="color:var(--urgent-color)">${err.message || 'Failed to compare versions.'}</p>`;
  }
}

function openVersionCompareModal() {
  $('versionCompareTitle').textContent = 'Compare versions';
  $('versionCompareBody').innerHTML = 'Loading…';
  const modal = $('versionCompareModal');
  modal.classList.remove('hidden');
  setTimeout(() => modal.classList.add('active'), 10);
}

function closeVersionCompareModal() {
  const modal = $('versionCompareModal');
  modal.classList.remove('active');
  setTimeout(() => modal.classList.add('hidden'), 300);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderVersionComparison(data) {
  $('versionCompareTitle').textContent = `Compare — ${escapeHtml(data.file_name)}`;

  const metaRow = `
    <div class="diff-meta-row">
      <span><strong>v${data.version_a.version_number}</strong> — ${escapeHtml(data.version_a.uploaded_by_name || 'Unknown')}, ${new Date(data.version_a.uploaded_at).toLocaleString()}</span>
      <span><strong>v${data.version_b.version_number}</strong> — ${escapeHtml(data.version_b.uploaded_by_name || 'Unknown')}, ${new Date(data.version_b.uploaded_at).toLocaleString()}</span>
    </div>`;

  if (!data.diffable) {
    $('versionCompareBody').innerHTML = metaRow + `
      <p style="color:var(--slate-400); font-size:12.5px; margin-bottom:14px;">${escapeHtml(data.reason)}</p>
      <div class="diff-sidebyside">
        <div><h4 style="margin:0 0 8px;">v${data.version_a.version_number}</h4><div id="diffSideA">Loading…</div></div>
        <div><h4 style="margin:0 0 8px;">v${data.version_b.version_number}</h4><div id="diffSideB">Loading…</div></div>
      </div>`;
    loadSideBySideVersion(data.version_a, 'diffSideA');
    loadSideBySideVersion(data.version_b, 'diffSideB');
    return;
  }

  const rows = data.diff.rows.map(r => `
    <tr class="${r.type === 'add' ? 'diff-row-add' : r.type === 'remove' ? 'diff-row-remove' : ''}">
      <td class="diff-line-no">${r.a_line ?? ''}</td>
      <td class="diff-line-no">${r.b_line ?? ''}</td>
      <td>${r.type === 'add' ? '+' : r.type === 'remove' ? '−' : ''}</td>
      <td>${escapeHtml(r.text)}</td>
    </tr>`).join('');

  $('versionCompareBody').innerHTML = metaRow + `
    <p style="color:var(--slate-400); font-size:12.5px; margin-bottom:10px;">
      <span style="color:var(--active-color)">+${data.diff.stats.additions}</span> &nbsp;
      <span style="color:var(--urgent-color)">−${data.diff.stats.deletions}</span>
    </p>
    <div class="table-container" style="max-height:60vh; overflow:auto;">
      <table class="diff-table"><tbody>${rows}</tbody></table>
    </div>`;
}

// Fetches one version's bytes the same auth-aware way downloadDocumentVersion
// does (a plain <img>/<iframe> src can't carry the Authorization header),
// then renders it inline as a blob URL instead of triggering a save-as.
async function loadSideBySideVersion(version, targetId) {
  const target = $(targetId);
  try {
    const res = await fetch(`/api/v1/files/${docDetailCurrentDocId}/versions/${version.id}/download`, { headers: { ...Auth.authHeader() } });
    if (res.status === 401) { handleUnauthenticated(); return; }
    if (!res.ok) throw new Error('Failed to load version content.');

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    if ((version.file_type || '').startsWith('image/')) {
      target.innerHTML = `<img src="${objectUrl}" alt="v${version.version_number}" />`;
    } else if (version.file_type === 'application/pdf') {
      target.innerHTML = `<iframe src="${objectUrl}" title="v${version.version_number}"></iframe>`;
    } else {
      target.innerHTML = `<p style="color:var(--slate-400); font-size:12.5px;">Preview not available for this format — <a href="${objectUrl}" download="${escapeHtml(version.original_name)}">download v${version.version_number}</a> to view it.</p>`;
    }
  } catch (err) {
    target.innerHTML = `<p style="color:var(--urgent-color); font-size:12.5px;">Failed to load this version.</p>`;
  }
}

// Same auth-aware blob-download approach as downloadDocument above (a
// plain link/navigation can't attach the Authorization header).
async function downloadDocumentVersion(versionId) {
  try {
    const res = await fetch(`/api/v1/files/${docDetailCurrentDocId}/versions/${versionId}/download`, { headers: { ...Auth.authHeader() } });
    if (res.status === 401) { handleUnauthenticated(); return; }
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      showToast(json.error || 'Download failed.', 'error');
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const filename = match ? decodeURIComponent(match[1]) : 'download';

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (e) {
    showToast('Download failed.', 'error');
  }
}

// `docDetailNewVersionFile`'s change listener reveals the comment field
// once a file is chosen — the prompt for an (optional) version comment
// happens right there, before the user ever clicks Upload, not as a
// separate confirm() step blocking the actual submit.
function setupDocumentDetailListeners() {
  if (docDetailListenersInitialized) return;
  docDetailListenersInitialized = true;

  $('docDetailModalCloseBtn').addEventListener('click', closeDocumentDetailModal);
  $('documentDetailModal').addEventListener('click', (e) => { if (e.target === $('documentDetailModal')) closeDocumentDetailModal(); });

  $('docDetailNewVersionFile').addEventListener('change', () => {
    const hasFile = $('docDetailNewVersionFile').files.length > 0;
    $('docDetailUploadVersionBtn').disabled = !hasFile;
    $('docDetailCommentGroup').classList.toggle('hidden', !hasFile);
  });

  $('docDetailUploadVersionBtn').addEventListener('click', handleUploadNewVersion);
  $('docDetailCompareBtn').addEventListener('click', handleCompareVersions);

  $('versionCompareModalCloseBtn').addEventListener('click', closeVersionCompareModal);
  $('versionCompareModal').addEventListener('click', (e) => { if (e.target === $('versionCompareModal')) closeVersionCompareModal(); });
}

async function handleUploadNewVersion() {
  const fileInput = $('docDetailNewVersionFile');
  const file = fileInput.files[0];
  if (!file || !docDetailCurrentDocId) return;

  const comment = $('docDetailVersionComment').value.trim();
  const btn = $('docDetailUploadVersionBtn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  try {
    const formData = new FormData();
    formData.append('file', file);
    if (comment) formData.append('comment', comment);

    const res = await ApiClient.postForm(`/api/v1/files/${docDetailCurrentDocId}/versions`, formData);
    if (!res.ok) throw new Error(res.json?.error || 'Failed to upload new version.');

    showToast('New version uploaded.', 'success');
    fileInput.value = '';
    $('docDetailVersionComment').value = '';
    $('docDetailCommentGroup').classList.add('hidden');
    await loadDocumentVersions(docDetailCurrentDocId);
    await loadVaultFiles(); // the file list's size/updated_at/etc. now reflect the new current version
  } catch (err) {
    showToast(err.message || 'Failed to upload new version.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload New Version';
  }
}

$('ctxPreview').addEventListener('click', () => { $('vaultContextMenu').classList.add('hidden'); handlePreview(currentCtxDocId); });
$('ctxDownload').addEventListener('click', () => { $('vaultContextMenu').classList.add('hidden'); downloadDocument(currentCtxDocId); });
$('ctxShare').addEventListener('click', () => { $('vaultContextMenu').classList.add('hidden'); openShareDrawer(currentCtxDocId); });
$('ctxFlag').addEventListener('click', async () => {
  $('vaultContextMenu').classList.add('hidden');
  const doc = VaultState.docs.find(d => d.id === currentCtxDocId);
  await ApiClient.patch(`/api/v1/files/${currentCtxDocId}`, { is_flagged: !doc.is_flagged });
  loadVaultFiles();
  loadVaultStats();
  showToast('Flag status updated', 'success');
});
$('ctxVersions').addEventListener('click', () => {
  $('vaultContextMenu').classList.add('hidden');
  openDocumentDetailModal(currentCtxDocId);
});
$('ctxDelete').addEventListener('click', async () => {
  $('vaultContextMenu').classList.add('hidden');
  if(confirm('Delete file?')) {
    await ApiClient.del(`/api/v1/files/${currentCtxDocId}`);
    loadVaultFiles();
    loadVaultStats();
    showToast('File deleted', 'success');
  }
});

function updateBulkActionBar() {
  const bar = $('bulkActionBar');
  if (VaultState.selectedDocIds.size > 0) {
    $('bulkCount').textContent = `${VaultState.selectedDocIds.size} selected`;
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
}

// ── URL SYNC ──
function updateUrlState() {
  const url = new URL(window.location);
  url.searchParams.set('tab', VaultState.activeTab);
  if (VaultState.selectedFolderId) url.searchParams.set('folder', VaultState.selectedFolderId);
  else url.searchParams.delete('folder');
  if (VaultState.searchQuery) url.searchParams.set('q', VaultState.searchQuery);
  else url.searchParams.delete('q');
  window.history.replaceState({}, '', url);
}

// ── MODALS & UPLOADS ──

function openVaultModal(id) {
  const overlay = $(id);
  overlay.classList.remove('hidden');
}
function closeVaultModal(id) {
  $(id).classList.add('hidden');
}
function closeVaultDrawer(id) {
  $(id).classList.add('hidden');
}

// Share Drawer
let shareDocId = null;
function openShareDrawer(docId) {
  shareDocId = docId;
  const doc = VaultState.docs.find(d => d.id === docId);
  $('shareDocName').textContent = doc.file_name;
  $('shareDocSize').textContent = (doc.file_size_bytes/(1024*1024)).toFixed(1) + ' MB';
  $('shareLinkBox').classList.add('hidden');
  $('shareDrawerOverlay').classList.remove('hidden');
}
function closeShareDrawer() {
  $('shareDrawerOverlay').classList.add('hidden');
}

$$('.perm-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    $$('.perm-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
  });
});

$('generateShareBtn').addEventListener('click', async () => {
  const email = $('shareEmail').value;
  if (!email) return showToast('Enter email', 'error');
  try {
    const res = await fetch(`/api/v1/files/${shareDocId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...Auth.authHeader() },
      body: JSON.stringify({ recipient_email: email, permission: document.querySelector('.perm-btn.active').dataset.perm })
    });
    if (res.status === 401) { handleUnauthenticated(); return; }
    const json = await res.json();
    if(json.success) {
      $('shareLinkBox').classList.remove('hidden');
      $('shareLinkInput').value = json.data.share_url;
      showToast('Link generated!', 'success');
    }
  } catch(e) { showToast('Error generating link', 'error'); }
});

$('copyLinkBtn').addEventListener('click', () => {
  $('shareLinkInput').select();
  document.execCommand('copy');
  showToast('Copied to clipboard', 'success');
});

// Preview Modal
async function handlePreview(docId) {
  try {
    const res = await fetch(`/api/v1/files/${docId}/preview`, { headers: { ...Auth.authHeader() } });
    if (res.status === 401) { handleUnauthenticated(); return; }
    const json = await res.json();
    if (json.success) {
      const data = json.data;
      $('previewFileName').textContent = data.file_name;
      $('previewFileBadge').textContent = data.file_name.split('.').pop().toUpperCase();
      
      const infoList = $('previewInfoList');
      infoList.innerHTML = `
        <div class="preview-info-item"><span class="preview-info-label">Type</span><span class="preview-info-value">${data.preview_type.toUpperCase()}</span></div>
        <div class="preview-info-item"><span class="preview-info-label">Expires</span><span class="preview-info-value">${new Date(data.expires_at).toLocaleString()}</span></div>
        <div class="preview-info-item"><span class="preview-info-label">Security</span><span class="preview-info-value" style="color:var(--teal-accent)">Watermarked & Read-Only</span></div>
      `;
      $('previewPlaceholderText').textContent = 'Preview loaded securely.';
      openVaultModal('previewModal');
    }
  } catch(e) {
    showToast('Preview generation failed', 'error');
  }
}

// File Upload Logic
let filesToUpload = [];

// `caseId` is optional — set (e.g. from the Cases page's "Upload to
// Document Index" row action) to pre-scope the upload to that case, the
// same way VaultService.initiateUpload already accepts a case_id server-
// side. Left undefined, this is the plain Document Vault "Upload Files"
// button's behavior, unchanged.
function openUploadModal(caseId) {
  filesToUpload = [];
  VaultState.presetCaseId = caseId || null;
  renderUploadList();
  if (VaultState.stats) {
    const pct = Math.round((VaultState.stats.storage_used_bytes / VaultState.stats.storage_limit_bytes) * 100);
    $('uploadQuotaFill').style.width = `${pct}%`;
    $('uploadQuotaLabel').textContent = `${VaultState.stats.storage_used_formatted} / ${VaultState.stats.storage_limit_formatted}`;
  }
  const titleEl = document.querySelector('#uploadModal .vault-modal-title');
  if (titleEl) titleEl.textContent = caseId ? `Upload Files — ${caseId}` : 'Upload Files';
  openVaultModal('uploadModal');
}

function initDragAndDrop() {
  const dropZone = $('dropZone');
  const fileInput = $('fileInputHidden');
  
  $('dropZoneClick').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
}

function handleFiles(files) {
  const allowed = ['pdf','doc','docx','xls','xlsx','png','jpg','jpeg'];
  for(const f of files) {
    const ext = f.name.split('.').pop().toLowerCase();
    if(allowed.includes(ext) && f.size <= 50*1024*1024) {
      filesToUpload.push({ file: f, progress: 0, status: 'pending' });
    } else {
      showToast(`File ${f.name} invalid format or too large`, 'error');
    }
  }
  renderUploadList();
}

function renderUploadList() {
  const list = $('uploadFileList');
  if(!filesToUpload.length) { list.innerHTML = ''; $('uploadSubmitBtn').disabled = true; return; }
  
  $('uploadSubmitBtn').disabled = false;
  list.innerHTML = filesToUpload.map((f, i) => `
    <div class="upload-file-item">
      <div class="upload-file-info">
        <div class="upload-file-name">${escapeHtml(f.file.name)}</div>
        <div class="upload-file-size">${(f.file.size/(1024*1024)).toFixed(1)} MB - ${f.status}</div>
        <div class="upload-progress-bar">
          <div class="upload-progress-fill" style="width:${f.progress}%"></div>
        </div>
      </div>
      <button class="upload-file-remove" data-action="remove-upload-file" data-index="${i}">&times;</button>
    </div>
  `).join('');
}

function removeUploadFile(index) {
  filesToUpload.splice(index, 1);
  renderUploadList();
}

$('uploadSubmitBtn').addEventListener('click', async () => {
  for(let i=0; i<filesToUpload.length; i++) {
    const f = filesToUpload[i];
    if(f.status === 'success') continue;

    f.status = 'uploading';
    f.progress = 30;
    renderUploadList();

    try {
      // Real multipart upload — the actual file bytes are sent (and
      // validated + signature-checked + written to disk server-side), not
      // just its name/size/type as before.
      const buildFormData = (allowDuplicate) => {
        const formData = new FormData();
        formData.append('file', f.file);
        if (VaultState.selectedFolderId) formData.append('folder_id', VaultState.selectedFolderId);
        if (VaultState.presetCaseId) formData.append('case_id', VaultState.presetCaseId);
        formData.append('tags', JSON.stringify([]));
        if (allowDuplicate) formData.append('allow_duplicate', 'true');
        return formData;
      };

      let res = await ApiClient.postForm('/api/v1/vault/upload', buildFormData(false));

      // Content-identical to an existing document (see
      // VaultService.initiateUpload's sha256 check) — ask before creating
      // a sibling file rather than silently doing it.
      if (res.status === 409 && res.json?.code === 'DUPLICATE_CONTENT') {
        const proceed = confirm(
          `${res.json.error}\n\nUpload "${f.file.name}" as a separate file anyway?`
        );
        if (proceed) {
          res = await ApiClient.postForm('/api/v1/vault/upload', buildFormData(true));
        } else {
          f.status = 'error';
          showToast(`Skipped ${f.file.name} — duplicate of an existing document.`, 'info');
          renderUploadList();
          continue;
        }
      }

      if (res.ok) {
        f.status = 'success';
        f.progress = 100;
      } else if (res.status === 413) {
        f.status = 'error';
        showToast(`Quota exceeded for ${f.file.name}`, 'error');
      } else {
        f.status = 'error';
        showToast(res.json?.error || `Upload failed for ${f.file.name}`, 'error');
      }
    } catch(e) {
      f.status = 'error';
    }
    renderUploadList();
  }

  showToast('Uploads completed', 'info');
  loadVaultStats();
  loadVaultFiles();
  setTimeout(() => { if(filesToUpload.every(f => f.status === 'success')) closeVaultModal('uploadModal'); }, 1500);
});

// ── WIDGETS ──

let vaultCalendarMonth = new Date().getMonth();
let vaultCalendarYear = new Date().getFullYear();
let vaultDeadlineEvents = [];

async function loadSidebarWidgets() {
  try {
    const data = await ApiClient.get('/api/v1/vault/sidebar-widgets');
    renderVaultCalendar(data.deadlines || []);
    renderVaultQuickAccess(data.quick_access || { recent_files: [], frequent_folders: [] });
    renderVaultClientMessages(data.client_messages || []);
  } catch (err) {
    console.error('Sidebar widgets load error', err);
    renderVaultCalendarError();
    renderVaultQuickAccessError();
    renderVaultClientMessagesError();
  }
}

function renderVaultCalendar(deadlines) {
  vaultDeadlineEvents = deadlines;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('vaultCalMonth').textContent = `${monthNames[vaultCalendarMonth]} ${vaultCalendarYear}`;
  $('deadlinesBadge').textContent = `${deadlines.length} upcoming`;

  const firstDay = new Date(vaultCalendarYear, vaultCalendarMonth, 1).getDay();
  const daysInMonth = new Date(vaultCalendarYear, vaultCalendarMonth + 1, 0).getDate();
  const daysInPrev = new Date(vaultCalendarYear, vaultCalendarMonth, 0).getDate();

  // Collect deadline days for current month/year
  const deadlineDays = new Set();
  deadlines.forEach(d => {
    const dlDate = new Date(d.deadline_date);
    if (dlDate.getMonth() === vaultCalendarMonth && dlDate.getFullYear() === vaultCalendarYear) {
      deadlineDays.add(dlDate.getDate());
    }
  });

  let html = `
    <div class="cal-header-row" style="display:grid;grid-template-columns:repeat(7,1fr);font-size:10px;color:var(--slate-400);padding:0 4px;margin-bottom:6px;text-align:center">
      <span>SU</span><span>MO</span><span>TU</span><span>WE</span><span>TH</span><span>FR</span><span>SA</span>
    </div>
    <div class="cal-days-matrix" style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">
  `;

  // Previous month days
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month" style="opacity:.3;text-align:center;padding:6px 0;font-size:11px">${daysInPrev - i}</div>`;
  }

  // Current month days
  const today = new Date();
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate() && vaultCalendarMonth === today.getMonth() && vaultCalendarYear === today.getFullYear();
    const hasDeadline = deadlineDays.has(d);
    let cls = 'cal-day';
    if (isToday) cls += ' active-day';
    if (hasDeadline) cls += ' has-deadline';
    html += `<div class="${cls}" data-day="${d}" data-month="${vaultCalendarMonth}" data-year="${vaultCalendarYear}" style="text-align:center;padding:6px 0;font-size:11px;cursor:pointer;position:relative;border-radius:4px;${isToday ? 'background:rgba(201,168,76,.2);color:var(--gold-400);font-weight:600' : ''}">${d}${hasDeadline ? '<div class="calendar-dot" style="position:absolute;bottom:2px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:#E74C3C"></div>' : ''}</div>`;
  }

  // Next month filler
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  let next = 1;
  for (let i = firstDay + daysInMonth; i < totalCells; i++) {
    html += `<div class="cal-day other-month" style="opacity:.3;text-align:center;padding:6px 0;font-size:11px">${next++}</div>`;
  }

  html += `</div>`;
  $('vaultCalendar').innerHTML = html;

  // Deadline list
  const listHtml = deadlines.length ? deadlines.map(d => {
    const dlDate = new Date(d.deadline_date);
    const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dlDate.getMonth()];
    return `
      <div class="deadline-item" style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:6px;border-left:3px solid ${d.badge_color || '#C9A84C'};cursor:pointer" data-action="toast" data-message="${escapeAttr(d.title)}" data-tone="info">
        <div style="font-size:10px;color:var(--slate-400);text-align:center;line-height:1.2;min-width:32px">
          <div style="font-size:11px;font-weight:600;color:var(--white)">${monthAbbr}</div>
          <div style="font-size:14px;font-weight:700;color:var(--white)">${dlDate.getDate()}</div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:500;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.title)}</div>
          <div style="font-size:10px;color:var(--slate-400);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.location)} · ${escapeHtml(d.time_text)}</div>
        </div>
        <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:${d.badge_color || '#C9A84C'}22;color:${d.badge_color || '#C9A84C'};font-weight:600;text-transform:uppercase">${escapeHtml(d.badge_type)}</span>
      </div>
    `;
  }).join('') : `<div style="font-size:11px;color:var(--slate-400);text-align:center;padding:16px">No upcoming deadlines</div>`;
  $('vaultDeadlineList').innerHTML = listHtml;
}

function renderVaultCalendarError() {
  $('vaultCalendar').innerHTML = `<div style="font-size:11px;color:#E74C3C;text-align:center;padding:16px">Failed to load calendar</div>`;
  $('vaultDeadlineList').innerHTML = '';
}

function renderVaultQuickAccess(quickAccess) {
  const { recent_files = [], frequent_folders = [] } = quickAccess;
  const iconColors = { pdf: '#E74C3C', docx: '#3B82F6', doc: '#3B82F6', xlsx: '#2DC8B0', jpg: '#9B59B6', png: '#9B59B6' };

  let html = '';

  if (recent_files.length) {
    html += `<div class="quick-sec-label" style="font-size:10px;color:var(--slate-400);margin:0 0 8px;text-transform:uppercase;letter-spacing:.5px">Recent Files</div>`;
    recent_files.forEach(f => {
      const ext = (f.extension || 'pdf').toLowerCase();
      const color = iconColors[ext] || '#8A99AD';
      html += `
        <div class="quick-item" data-action="preview-document" data-document-id="${escapeAttr(f.id)}" style="margin-bottom:6px">
          <span class="file-icon-badge" style="background:${color}22;color:${color};font-size:9px;padding:3px 6px;border-radius:4px;font-weight:600">${ext.toUpperCase()}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.file_name)}</div>
            <div style="font-size:10px;color:var(--slate-400)">${escapeHtml(f.case_id) || '—'}</div>
          </div>
        </div>
      `;
    });
  }

  if (frequent_folders.length) {
    html += `<div class="quick-sec-label" style="font-size:10px;color:var(--slate-400);margin:14px 0 8px;text-transform:uppercase;letter-spacing:.5px">Frequent Folders</div>`;
    frequent_folders.forEach(f => {
      html += `
        <div class="quick-item" data-action="select-folder" data-folder-id="${escapeAttr(f.id)}" data-folder-name="${escapeAttr(f.folder_name || '')}" style="margin-bottom:6px">
          <svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.folder_name)}</div>
            <div style="font-size:10px;color:var(--slate-400)">${f.document_count} files</div>
          </div>
        </div>
      `;
    });
  }

  if (!html) {
    html = `<div style="font-size:11px;color:var(--slate-400);text-align:center;padding:16px">No quick access items</div>`;
  }

  $('vaultQuickAccess').innerHTML = html;
}

function renderVaultQuickAccessError() {
  $('vaultQuickAccess').innerHTML = `<div style="font-size:11px;color:#E74C3C;text-align:center;padding:16px">Failed to load quick access</div>`;
}

function renderVaultClientMessages(messages) {
  const unreadCount = messages.filter(m => m.is_unread).length;
  $('msgUnreadBadge').textContent = `${unreadCount} unread`;

  if (!messages.length) {
    $('vaultMessages').innerHTML = `<div style="font-size:11px;color:var(--slate-400);text-align:center;padding:16px">No messages</div>`;
    return;
  }

  const colorMap = { JA: '#C9A84C', ED: '#3B82F6', LJ: '#2DC8B0', CG: '#9B59B6', AR: '#F39C12' };
  const avatarColors = ['#C9A84C', '#3B82F6', '#2DC8B0', '#9B59B6', '#F39C12'];

  $('vaultMessages').innerHTML = messages.slice(0, 3).map((m, i) => {
    const initials = m.client_avatar || m.client_name.split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase();
    const color = colorMap[initials] || avatarColors[i % avatarColors.length];
    return `
      <div class="client-msg-card hoverable-card" data-action="navigate" data-page="communications" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:8px;margin-bottom:8px;transition:background .2s">
        <div style="width:30px;height:30px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-weight:600;font-size:11px;flex-shrink:0">${escapeHtml(initials)}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:12px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.client_name)}${m.is_urgent ? ' <span style="color:#E74C3C;font-size:10px">⚠</span>' : ''}</div>
            <div style="font-size:10px;color:var(--slate-400);flex-shrink:0;margin-left:6px">${escapeHtml(m.timestamp_text)}</div>
          </div>
          <div style="font-size:11px;color:var(--slate-400);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${escapeHtml(m.preview)}</div>
        </div>
        ${m.is_unread ? `<div style="width:18px;height:18px;border-radius:50%;background:#E74C3C;color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0">1</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderVaultClientMessagesError() {
  $('vaultMessages').innerHTML = `<div style="font-size:11px;color:#E74C3C;text-align:center;padding:16px">Failed to load messages</div>`;
}

// Calendar navigation
$('vaultCalPrev') && $('vaultCalPrev').addEventListener('click', () => {
  vaultCalendarMonth--;
  if (vaultCalendarMonth < 0) { vaultCalendarMonth = 11; vaultCalendarYear--; }
  renderVaultCalendar(vaultDeadlineEvents);
});
$('vaultCalNext') && $('vaultCalNext').addEventListener('click', () => {
  vaultCalendarMonth++;
  if (vaultCalendarMonth > 11) { vaultCalendarMonth = 0; vaultCalendarYear++; }
  renderVaultCalendar(vaultDeadlineEvents);
});

// ── EXPORT OR REPLACE ──
// Overrides the existing initDocumentVault stub in app.js

/* ════════════════════════════════════════════════════════════════════════════
   AI COPILOT DRAWER LOGIC
   ═══════════════════════════════════════════════════════════════════════════ */

function openCopilotDrawer() {
  const overlay = $('copilotDrawerOverlay');
  const drawer = $('copilotDrawer');
  if (!overlay || !drawer) return;
  overlay.classList.remove('hidden');
  setTimeout(() => {
    overlay.classList.add('active');
    drawer.classList.add('active');
    $('copilotChatInput')?.focus();
  }, 10);
  $('copilotDot') && ($('copilotDot').style.display = 'none');
}

function closeCopilotDrawer() {
  const overlay = $('copilotDrawerOverlay');
  const drawer = $('copilotDrawer');
  if (!overlay || !drawer) return;
  drawer.classList.remove('active');
  overlay.classList.remove('active');
  setTimeout(() => overlay.classList.add('hidden'), 250);
}

// ══════════════════════════════════════
// COPILOT CHAT
//
// This used to be a client-side if/else ladder: the prompt was lowercased
// and matched against 'summarize' / 'deadline' / 'bill' / 'search', each
// branch calling one fixed endpoint. It could not answer a question that
// did not contain one of those words, could not combine two lookups, and
// had no memory of the previous turn — and the carefully written
// COPILOT_SYSTEM_PROMPT on the server was imported by nothing.
//
// It now posts to POST /api/v1/copilot/chat, which runs a real tool-calling
// loop over read-only, role-scoped tools. See server/services/copilotAgent.js.
// ══════════════════════════════════════

// The transcript sent back to the server each turn (the API is stateless).
// Capped server-side too; this just avoids sending an ever-growing body.
let copilotHistory = [];

async function handleCopilotChat(prompt) {
  if (!prompt.trim()) return;

  appendChatMessage('user', prompt);
  $('copilotChatInput').value = '';

  const typingId = 'typing-' + Date.now();
  appendChatMessage('assistant', '<em>Thinking…</em>', typingId);

  try {
    const res = await ApiClient.post('/api/v1/copilot/chat', {
      message: prompt,
      history: copilotHistory
    });

    removeChatMessage(typingId);

    const data = res.data || {};
    const reply = data.reply || 'I don\'t have anything to add to that.';

    appendChatMessage('assistant', renderAssistantMarkdown(reply));

    // Only record turns that actually completed, so a failed turn doesn't
    // poison the context of the next one.
    copilotHistory.push({ role: 'user', content: prompt });
    copilotHistory.push({ role: 'assistant', content: reply });
    if (copilotHistory.length > 40) copilotHistory = copilotHistory.slice(-40);

    // A mutating request comes back as a proposal, never as a completed
    // change — see the human-in-the-loop rule in copilotSystemPrompt.js.
    if (Array.isArray(data.proposals) && data.proposals.length) {
      data.proposals.forEach(renderCopilotProposal);
    }
  } catch (err) {
    removeChatMessage(typingId);

    // The server says explicitly when conversational mode is unavailable
    // (no Anthropic key configured, or a non-Anthropic provider). Say that
    // plainly instead of showing a generic error, and point at what still
    // works, rather than silently degrading to something that looks like an
    // answer.
    if (err && /COPILOT_AI_UNAVAILABLE/.test(err.message || '')) {
      appendChatMessage('assistant', escapeHtml(err.message));
      return;
    }
    console.error('Copilot chat error:', err);
    appendChatMessage('assistant', `Sorry, I ran into an error: ${escapeHtml(err.message || 'unknown error')}`);
  }
}

// Renders a pending change for the user to approve. The Copilot cannot
// apply changes itself — approving here is what calls the already-gated,
// human-in-the-loop endpoints that do.
function renderCopilotProposal(proposal) {
  const container = $('copilotChatMessages');
  if (!container) return;

  const id = 'proposal-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  container.insertAdjacentHTML('beforeend', `
    <div class="chat-proposal" id="${id}" style="margin:8px 0 8px 38px;padding:10px 12px;border:1px solid rgba(201,168,76,.35);background:rgba(201,168,76,.08);border-radius:8px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#C9A84C;font-weight:600;margin-bottom:4px">Awaiting your approval</div>
      <div style="font-size:13px;color:var(--slate-300);line-height:1.5">${escapeHtml(proposal.summary || 'Proposed change')}</div>
      <div style="font-size:11px;color:var(--slate-400);margin-top:4px">Target: ${escapeHtml(proposal.target_id || '—')}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn-primary" style="padding:4px 12px;font-size:12px" data-action="copilot-approve" data-proposal-id="${escapeAttr(id)}">Approve</button>
        <button class="btn-ghost" style="padding:4px 12px;font-size:12px" data-action="copilot-dismiss" data-proposal-id="${escapeAttr(id)}">Dismiss</button>
      </div>
    </div>
  `);
  container.scrollTop = container.scrollHeight;

  // Stashed on the element rather than in the markup so the payload is
  // never re-parsed out of HTML.
  const el = $(id);
  if (el) el._proposal = proposal;
}

async function handleCopilotProposalApprove(el) {
  const box = $(el.dataset.proposalId);
  const proposal = box && box._proposal;
  if (!proposal) return;

  box.querySelectorAll('button').forEach(b => { b.disabled = true; });

  try {
    if (proposal.action === 'update_case') {
      await ApiClient.post('/api/v1/copilot/cases', {
        case_id: proposal.target_id,
        ...(proposal.details || {}),
        approved: true
      });
    } else if (proposal.action === 'manage_file') {
      const details = proposal.details || {};
      await ApiClient.post('/api/v1/copilot/manage-files', {
        action: details.operation || details.action,
        target_id: proposal.target_id,
        target_type: details.target_type || 'file',
        payload: details,
        approved: true
      });
    } else {
      throw new Error(`Unsupported proposal type: ${proposal.action}`);
    }

    box.innerHTML = `<div style="font-size:12px;color:#2DC8B0">✓ Applied: ${escapeHtml(proposal.summary || '')}</div>`;
    showToast('Change applied.', 'success');
    if (typeof loadCases === 'function') loadCases();
  } catch (err) {
    box.querySelectorAll('button').forEach(b => { b.disabled = false; });
    showToast(`Could not apply: ${err.message}`, 'error');
  }
}

function handleCopilotProposalDismiss(el) {
  const box = $(el.dataset.proposalId);
  if (box) box.remove();
}

registerActions({
  'copilot-approve': (el) => handleCopilotProposalApprove(el),
  'copilot-dismiss': (el) => handleCopilotProposalDismiss(el),
});

// Minimal, allow-list markdown for assistant replies.
//
// IMPORTANT: the text is HTML-escaped FIRST, then a small, fixed set of
// formatting patterns is re-introduced. Model output is untrusted input
// like any other — it can quote a document that itself contains markup —
// and appendChatMessage writes its argument as innerHTML. Escaping first
// and formatting second means no path exists from model text to live HTML.
function renderAssistantMarkdown(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\`([^\`]+)\`/g, '<code style="background:rgba(255,255,255,.08);padding:1px 4px;border-radius:3px">$1</code>')
    .replace(/^[-•]\s+(.*)$/gm, '<div style="margin-left:10px">• $1</div>')
    .replace(/\n/g, '<br>');
}

function appendChatMessage(role, content, id = null) {
  const container = $('copilotChatMessages');
  if (!container) return;

  const msgId = id || `msg-${Date.now()}`;
  const isUser = role === 'user';
  const avatarHtml = isUser
    ? '<div class="msg-avatar" style="width:28px;height:28px;border-radius:50%;background:rgba(201,168,76,.15);color:#C9A84C;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;font-weight:600">SJ</div>'
    : '<div class="msg-avatar" style="width:28px;height:28px;border-radius:50%;background:rgba(155,89,182,.15);color:#9B59B6;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px;font-weight:600">AI</div>';

  const messageHtml = `
    <div class="chat-message ${role}" id="${msgId}" style="display:flex;gap:10px;${isUser ? 'flex-direction:row-reverse' : ''}">
      ${avatarHtml}
      <div class="msg-content" style="flex:1;min-width:0;${isUser ? 'text-align:right' : ''}">
        <div style="font-size:13px;color:var(--slate-300);line-height:1.5">${content}</div>
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', messageHtml);
  container.scrollTop = container.scrollHeight;
}

function removeChatMessage(id) {
  const el = $(id);
  if (el) el.remove();
}


// ── INITIALIZATION ──

function initCopilot() {
  // Drawer open/close
  $('copilotBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCopilotDrawer();
  });

  $('copilotDrawerOverlay')?.addEventListener('click', (e) => {
    if (e.target === $('copilotDrawerOverlay')) closeCopilotDrawer();
  });

  // Chat input
  $('copilotChatSend')?.addEventListener('click', () => {
    const input = $('copilotChatInput');
    if (input?.value?.trim()) handleCopilotChat(input.value.trim());
  });

  $('copilotChatInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const input = $('copilotChatInput');
      if (input?.value?.trim()) handleCopilotChat(input.value.trim());
    }
  });

  // Quick action chips
  $$('.quick-action-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      if (prompt) handleCopilotChat(prompt);
    });
  });

  // ESC to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const overlay = $('copilotDrawerOverlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        closeCopilotDrawer();
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateDate();
  initSidebar();
  initProfileDropdown();
  initNotifications();
  initSearch();
  initCaseTable();
  initCalendar();
  initNewCaseButton();
  initCopilot();
  // Dashboard content, case data, and the welcome toast all depend on an
  // authenticated identity now (real per-user names/counts, not a
  // hardcoded "Sarah"/"3 urgent items") — loaded by loadInitialAppData()
  // once auth resolves, see initAuth() and the login handler above.

  // Link dashboard cards to their pages
  const cards = $$('.stat-card');
  if (cards[0]) cards[0].addEventListener('click', () => navigateToPage('cases'));
  if (cards[1]) cards[1].addEventListener('click', () => navigateToPage('documents'));
  if (cards[2]) cards[2].addEventListener('click', () => navigateToPage('communications'));
  if (cards[3]) cards[3].addEventListener('click', () => navigateToPage('billing'));

  // Intersection observer for card animations (re-trigger on scroll)
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '';
        entry.target.style.animation = 'fadeInUp 0.5s ease forwards';
      }
    });
  }, { threshold: 0.1 });

  $$('[data-animate]').forEach(el => observer.observe(el));
});
