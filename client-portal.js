'use strict';

/* ══════════════════════════════════════════════════════════════════════
   SLF CLIENT PORTAL
   A separate, simplified app for CLIENT-role users — NOT the staff SPA
   (index.html/app.js) with server-filtered responses reused. It only
   knows about four things a client cares about: case status, documents,
   messages, and invoices, each backed by the same role-scoped API the
   staff app calls (server/services/{caseService,communicationsService,
   invoiceService}.js — every read there is scoped server-side to this
   user's own cases; nothing here does any filtering of its own that
   matters for security).

   Component structure (each a small, independent piece — no framework,
   consistent with the rest of this codebase):
     Auth       — session bootstrap/guard, sign-out
     Api        — thin fetch wrapper (auth header, 401 handling)
     Toast      — one-line success/error notices
     Router     — hash-based routing: #cases, #case/<id>, #documents[/<id>],
                  #messages[/<id>], #invoices — the leading segment picks
                  the view, an optional second segment is passed through
                  as that view's `param`
     Shell      — header chrome (name, avatar, sign out, active nav tab)
     CasesView, DocumentsView, MessagesView, InvoicesView
                — one render function per tab, each owns its own fetch
     CaseDetailView
                — the drill-down opened by clicking a case card; reached
                  at #case/<id>, not nested inside CasesView
   ══════════════════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatMoney(cents) {
  return (Number(cents || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// For real ISO timestamps (e.g. activity-feed entries) — NOT for the
// Messages tab's `time` field, which arrives already formatted server-side
// (see MessagesView) and would silently render blank if re-parsed here.
function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Auth ─────────────────────────────────────────────────────────────────
// The session token lives in an HttpOnly cookie the server sets on login
// (see server/utils/sessionCookie.js) — the same cookie the staff app
// (app.js) already has, since a CLIENT-role login redirects here — so a
// session started at the login form carries straight over with no
// re-login and no token this client needs to read or forward itself. Only
// a non-sensitive display copy of the user is cached in localStorage.
const Auth = {
  USER_KEY: 'slf_auth_user',
  getUser() { try { return JSON.parse(localStorage.getItem(this.USER_KEY) || 'null'); } catch { return null; } },
  setUser(user) { try { localStorage.setItem(this.USER_KEY, JSON.stringify(user)); } catch { /* ignore */ } },
  clearSession() {
    try { localStorage.removeItem(this.USER_KEY); } catch { /* ignore */ }
  }
};

// ── Api ──────────────────────────────────────────────────────────────────
const Api = {
  async get(path) { return this._request(path, { method: 'GET' }); },
  async post(path, body) {
    return this._request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  },
  // No Content-Type header here, deliberately — fetch sets
  // multipart/form-data with the correct boundary itself when the body is
  // a FormData instance; setting it manually strips the boundary and the
  // server can no longer parse the request.
  async upload(path, formData) {
    return this._request(path, { method: 'POST', body: formData });
  },
  async _request(path, opts) {
    // The session cookie is attached automatically for this same-origin
    // request — nothing to add to headers here.
    const res = await fetch(`/api/v1${path}`, opts);
    if (res.status === 401) {
      Auth.clearSession();
      window.location.href = '/';
      throw new Error('Session expired.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      throw new Error(json.error || 'Request failed.');
    }
    return json.data;
  }
};

// ── Toast ────────────────────────────────────────────────────────────────
function showToast(message, isError) {
  const el = document.createElement('div');
  el.className = 'portal-toast' + (isError ? ' error' : '');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Router ───────────────────────────────────────────────────────────────
const Router = {
  // A getter, not a plain property: CasesView/DocumentsView/etc. are
  // declared further down this file as `const`, so evaluating this object
  // literal eagerly (at Router's own declaration time) would hit them
  // while still in their temporal dead zone. Deferring evaluation to each
  // call — by which point the whole script has finished running — avoids
  // that.
  get routes() {
    return {
      cases: CasesView, case: CaseDetailView,
      documents: DocumentsView, messages: MessagesView, invoices: InvoicesView
    };
  },
  // A route that isn't its own top-level tab still belongs to one for nav
  // highlighting purposes — the case detail page (#case/<id>) is reached
  // by clicking into "My Cases", so it keeps that tab looking active.
  navTabFor: { case: 'cases' },
  current: null,

  init() {
    document.querySelectorAll('.portal-nav-link').forEach(btn => {
      btn.addEventListener('click', () => { window.location.hash = btn.dataset.route; });
    });
    window.addEventListener('hashchange', () => this.render());
    this.render();
  },

  navigate(route, param) {
    window.location.hash = param ? `${route}/${param}` : route;
  },

  render() {
    const [route, param] = (window.location.hash || '#cases').slice(1).split('/');
    const view = this.routes[route] ? route : 'cases';
    this.current = view;
    const activeTab = this.navTabFor[view] || view;

    document.querySelectorAll('.portal-nav-link').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.route === activeTab);
    });

    const main = $('portalMain');
    main.innerHTML = '<div class="portal-empty">Loading…</div>';
    this.routes[view].render(main, param).catch(err => {
      main.innerHTML = `<div class="portal-empty">${escapeHtml(err.message || 'Something went wrong.')}</div>`;
    });
  }
};

// ── Shell ────────────────────────────────────────────────────────────────
function renderShell(user) {
  $('portalUserName').textContent = user.full_name;
  $('portalUserAvatar').textContent =
    user.initials || user.full_name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  $('portalRoot').classList.remove('hidden');
  $('portalLoading').classList.add('hidden');

  $('portalSignOutBtn').addEventListener('click', async () => {
    // Revoke server-side first, so the token stops working everywhere
    // rather than only being forgotten by this browser — same reasoning
    // as the staff app's sign-out (see app.js). Best-effort: the local
    // session is cleared even if the call fails.
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Server-side logout failed; clearing local session anyway.', err);
    }
    Auth.clearSession();
    window.location.href = '/';
  });
}

// ── CasesView ────────────────────────────────────────────────────────────
const CasesView = {
  async render(main) {
    const cases = await Api.get('/cases');
    if (!cases.length) {
      main.innerHTML = viewHeader('My Cases', 'Status and details for every matter we handle for you.') +
        '<div class="portal-empty">You don\'t have any cases on file yet.</div>';
      return;
    }

    main.innerHTML = viewHeader('My Cases', 'Status and details for every matter we handle for you.') +
      `<div class="portal-case-grid">${cases.map(caseCard).join('')}</div>`;

    main.querySelectorAll('.portal-case-card').forEach(card => {
      card.addEventListener('click', () => Router.navigate('case', card.dataset.caseId));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Router.navigate('case', card.dataset.caseId); }
      });
    });
  }
};

function caseCard(c) {
  const statusClass = `status-${(c.status || '').toLowerCase()}`;
  return `
    <div class="portal-card portal-case-card" data-case-id="${escapeHtml(c.id)}" role="button" tabindex="0">
      <div class="portal-case-card-head">
        <div>
          <div class="portal-case-name">${escapeHtml(c.name)}</div>
          <div class="portal-case-id">${escapeHtml(c.id)}</div>
        </div>
        <span class="portal-badge ${statusClass}">${escapeHtml(c.status || 'Unknown')}</span>
      </div>
      <dl class="portal-case-meta">
        <div><dt>Attorney</dt><dd>${escapeHtml(c.attorney || 'Unassigned')}</dd></div>
        <div><dt>Opposing Party</dt><dd>${escapeHtml(c.opposingParty || '—')}</dd></div>
        <div><dt>Next Hearing</dt><dd>${escapeHtml(c.nextHearing || 'None scheduled')}</dd></div>
        <div><dt>Opened</dt><dd>${formatDate(c.createdDate)}</dd></div>
      </dl>
    </div>`;
}

// ── CaseDetailView ───────────────────────────────────────────────────────
// The drill-down opened by clicking a case card (#case/<id>). Fetches the
// SAME role-scoped endpoint the staff Active Cases page uses
// (GET /api/v1/cases/:id → CaseService.getCase → db.getCaseByIdForUser) —
// no separate "client detail" API was needed since that endpoint already
// returns every field toCaseView produces, several of which (opposing
// counsel, case type, last-activity time) the summary card never showed.
// A CLIENT requesting a case that isn't theirs gets the same 404 here
// that getCase() already throws — this view adds no scoping of its own.
const CaseDetailView = {
  async render(main, caseId) {
    if (!caseId) { Router.navigate('cases'); return; }
    const c = await Api.get(`/cases/${encodeURIComponent(caseId)}`);
    const statusClass = `status-${(c.status || '').toLowerCase()}`;

    main.innerHTML = `
      <button class="portal-back-link" id="backToCases">&larr; My Cases</button>
      <div class="portal-detail-head">
        <div>
          <h1 class="portal-view-title">${escapeHtml(c.name)}</h1>
          <p class="portal-view-subtitle">${escapeHtml(c.id)}</p>
        </div>
        <span class="portal-badge ${statusClass}">${escapeHtml(c.status || 'Unknown')}</span>
      </div>

      <div class="portal-card portal-detail-card">
        <dl class="portal-detail-grid">
          <div><dt>Client of Record</dt><dd>${escapeHtml(c.client || '—')}</dd></div>
          <div><dt>Case Type</dt><dd>${escapeHtml(c.type || '—')}</dd></div>
          <div><dt>Lead Attorney</dt><dd>${escapeHtml(c.attorney || 'Unassigned')}</dd></div>
          <div><dt>Opposing Party</dt><dd>${escapeHtml(c.opposingParty || '—')}</dd></div>
          <div><dt>Opposing Counsel</dt><dd>${escapeHtml(c.opposingCounsel || '—')}</dd></div>
          <div><dt>Next Hearing</dt><dd>${escapeHtml(c.nextHearing || 'None scheduled')}</dd></div>
          <div><dt>Opened</dt><dd>${formatDate(c.createdDate)}</dd></div>
          <div><dt>Last Activity</dt><dd>${escapeHtml(c.activity || '—')}</dd></div>
        </dl>
        <p class="portal-description-text">${c.description ? escapeHtml(c.description) : 'No description on file yet.'}</p>
        <div class="portal-detail-actions">
          <button class="portal-btn-primary" id="detailViewDocsBtn">View Documents</button>
          <button class="portal-btn-primary" id="detailViewMsgsBtn">Message About This Case</button>
        </div>
      </div>

      <h2 class="portal-section-title">Hearing Schedule</h2>
      <div class="portal-card" id="hearingScheduleContainer">
        <div class="portal-empty">Loading…</div>
      </div>

      <h2 class="portal-section-title">Activity History</h2>
      <div class="portal-card" id="activityTimelineContainer">
        <div class="portal-empty">Loading…</div>
      </div>`;

    $('backToCases').addEventListener('click', () => Router.navigate('cases'));
    $('detailViewDocsBtn').addEventListener('click', () => Router.navigate('documents', c.id));
    $('detailViewMsgsBtn').addEventListener('click', () => Router.navigate('messages', c.id));

    await Promise.all([
      HearingSchedule.render($('hearingScheduleContainer'), c.id),
      ActivityTimeline.render($('activityTimelineContainer'), c.id)
    ]);
  }
};

// ── HearingSchedule ──────────────────────────────────────────────────────
// Not a routed view — an embedded component rendered into CaseDetailView.
// Backed by a dedicated endpoint (GET /api/v1/cases/:id/deadlines) rather
// than reusing toCaseView's single "next hearing" field, since a case can
// have many case_deadlines rows and the summary card was only ever
// showing the soonest upcoming one.
const HearingSchedule = {
  async render(container, caseId) {
    const deadlines = await Api.get(`/cases/${encodeURIComponent(caseId)}/deadlines`);
    if (!deadlines.length) {
      container.innerHTML = '<div class="portal-empty">No hearings or deadlines are on file for this case.</div>';
      return;
    }
    container.innerHTML = `
      <table class="portal-table">
        <thead>
          <tr><th>Date</th><th>Type</th><th>Title</th><th>Location</th><th>Status</th></tr>
        </thead>
        <tbody>${deadlines.map(deadlineRow).join('')}</tbody>
      </table>`;
  }
};

function deadlineRow(d) {
  return `
    <tr>
      <td>${escapeHtml(d.dateFormatted)}${d.timeText ? `<div class="portal-doc-sub">${escapeHtml(d.timeText)}</div>` : ''}</td>
      <td>${escapeHtml(d.badgeType || 'Hearing')}</td>
      <td>${escapeHtml(d.title)}</td>
      <td>${escapeHtml(d.location || '—')}</td>
      <td><span class="portal-badge status-${escapeHtml(d.status)}">${escapeHtml(d.status)}</span></td>
    </tr>`;
}

// ── ActivityTimeline ─────────────────────────────────────────────────────
// Also embedded in CaseDetailView, not a routed view. Backed by
// GET /api/v1/cases/:id/activity, which merges case-lifecycle events,
// document actions (including the AI Copilot's), and messages tied to
// this case into one chronological feed (server/db.js's
// listActivityForCase) — this component just renders whatever shape that
// already comes back in, newest first.
const ActivityTimeline = {
  async render(container, caseId) {
    const activity = await Api.get(`/cases/${encodeURIComponent(caseId)}/activity`);
    if (!activity.length) {
      container.innerHTML = '<div class="portal-empty">No activity recorded for this case yet.</div>';
      return;
    }
    container.innerHTML = `<ul class="portal-timeline">${activity.map(timelineItem).join('')}</ul>`;
  }
};

function timelineItem(a) {
  const who = escapeHtml(a.actorName || 'Someone');
  const target = a.targetName ? ` — <strong>${escapeHtml(a.targetName)}</strong>` : '';
  return `
    <li class="portal-timeline-item">
      <div class="portal-timeline-dot portal-timeline-dot-${escapeHtml(a.type)}"></div>
      <div class="portal-timeline-body">
        <div class="portal-timeline-label">${escapeHtml(a.label)}${target}</div>
        <div class="portal-timeline-meta">${who} · ${formatDateTime(a.date)}</div>
      </div>
    </li>`;
}

// ── DocumentsView ────────────────────────────────────────────────────────
const DocumentsView = {
  cases: null,
  selectedCaseId: null,

  async render(main, caseId) {
    const cases = await Api.get('/cases');
    this.cases = cases;
    if (!cases.length) {
      main.innerHTML = viewHeader('Documents', 'Files shared with you for each of your cases.') +
        '<div class="portal-empty">You don\'t have any cases on file yet.</div>';
      return;
    }

    // A caseId in the URL (arrived via the "View Documents" button on a
    // case's detail page) always wins over whatever was selected before.
    if (caseId && cases.find(c => c.id === caseId)) {
      this.selectedCaseId = caseId;
    } else if (!this.selectedCaseId || !cases.find(c => c.id === this.selectedCaseId)) {
      this.selectedCaseId = cases[0].id;
    }

    main.innerHTML = viewHeader('Documents', 'Files shared with you for each of your cases.') + `
      <div class="portal-layout-split">
        <div class="portal-card portal-side-list" id="docCaseList"></div>
        <div class="portal-card" id="docList"></div>
      </div>`;

    this.renderCaseList();
    await this.renderDocs();
  },

  renderCaseList() {
    $('docCaseList').innerHTML = this.cases.map(c => `
      <button class="portal-side-item ${c.id === this.selectedCaseId ? 'active' : ''}" data-case-id="${escapeHtml(c.id)}">
        ${escapeHtml(c.name)}
        <span class="portal-side-item-sub">${escapeHtml(c.id)}</span>
      </button>`).join('');

    $('docCaseList').querySelectorAll('.portal-side-item').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedCaseId = btn.dataset.caseId;
        this.renderCaseList();
        this.renderDocs();
      });
    });
  },

  async renderDocs() {
    const container = $('docList');
    container.innerHTML = '<div class="portal-empty">Loading documents…</div>';
    const docs = await Api.get(`/cases/${encodeURIComponent(this.selectedCaseId)}/documents`);

    const rowsHtml = docs.length
      ? docs.map(docRow).join('')
      : '<div class="portal-empty">No documents have been shared for this case yet.</div>';

    container.innerHTML = `
      <form class="portal-upload-bar" id="uploadForm">
        <input type="file" id="uploadFileInput" required />
        <button type="submit" class="portal-btn-primary" id="uploadSubmitBtn">Upload</button>
      </form>
      <div id="docRows">${rowsHtml}</div>`;

    // Uploads to /api/v1/cases/:id/documents — same case-ownership check
    // and quota/malware-scan pipeline a staff upload goes through (see
    // server/routes/api.js), just reached from the client's own side
    // instead of the staff Document Vault.
    $('uploadForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('uploadFileInput');
      const file = input.files[0];
      if (!file) return;

      const btn = $('uploadSubmitBtn');
      btn.disabled = true;
      btn.textContent = 'Uploading…';
      try {
        const formData = new FormData();
        formData.append('file', file);
        await Api.upload(`/cases/${encodeURIComponent(this.selectedCaseId)}/documents`, formData);
        showToast('Document uploaded.');
        await this.renderDocs();
      } catch (err) {
        showToast(err.message, true);
        btn.disabled = false;
        btn.textContent = 'Upload';
      }
    });

    container.querySelectorAll('.portal-doc-preview').forEach(btn => {
      btn.addEventListener('click', () => {
        openPreviewModal(btn.dataset.docId, btn.dataset.fileName, btn.dataset.extension);
      });
    });

    container.querySelectorAll('.portal-doc-download').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await downloadDocument(btn.dataset.docId, btn.dataset.fileName);
        } catch (err) {
          showToast(err.message, true);
        } finally {
          btn.disabled = false;
        }
      });
    });
  }
};

function docRow(d) {
  const sizeKb = Math.max(1, Math.round((d.file_size_bytes || 0) / 1024));
  return `
    <div class="portal-doc-row">
      <div class="portal-doc-icon">${escapeHtml(d.extension || 'file')}</div>
      <div class="portal-doc-info">
        <div class="portal-doc-name">${escapeHtml(d.file_name)}</div>
        <div class="portal-doc-sub">${escapeHtml(d.category || 'Uncategorized')} · ${sizeKb} KB · Uploaded ${formatDate(d.created_at)}</div>
      </div>
      <div class="portal-doc-actions">
        <button class="portal-doc-preview" data-doc-id="${escapeHtml(d.id)}" data-file-name="${escapeHtml(d.file_name)}" data-extension="${escapeHtml(d.extension || '')}">Preview</button>
        <button class="portal-doc-download" data-doc-id="${escapeHtml(d.id)}" data-file-name="${escapeHtml(d.file_name)}">Download</button>
      </div>
    </div>`;
}

// Fetched as a blob (rather than a plain `<a href>`/`<iframe src>`
// navigation) so a non-2xx response — e.g. an expired session — is caught
// here and turned into a proper redirect-to-login instead of the browser
// just rendering a raw 401 JSON error in place of the document.
async function fetchFileBlob(docId, intent) {
  const qs = intent ? `?intent=${encodeURIComponent(intent)}` : '';
  const res = await fetch(`/api/v1/files/${encodeURIComponent(docId)}/download${qs}`);
  if (res.status === 401) {
    Auth.clearSession();
    window.location.href = '/';
    throw new Error('Session expired.');
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || 'Could not load this file.');
  }
  return res.blob();
}

async function downloadDocument(docId, fileName) {
  const blob = await fetchFileBlob(docId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const PREVIEWABLE_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'];

// Calls the same GET /api/v1/files/:id/preview endpoint the staff app
// uses (FileService.getPreview) — that endpoint has only ever returned
// metadata (file name/type, an expiry, a `preview_type` label), never a
// real rendered page; there's no `/render` route anywhere in this app to
// back the preview_url it mints. For the two content types a browser can
// actually render natively (PDF, images) this renders the REAL file —
// fetched as a blob the same authenticated way downloadDocument() does —
// in an iframe/img; every other type falls back to the same
// metadata-only view the staff app has always shown, honestly labeled as
// "not available" rather than faking a renderer that doesn't exist.
async function openPreviewModal(docId, fileName, extension) {
  let meta;
  try {
    meta = await Api.get(`/files/${encodeURIComponent(docId)}/preview`);
  } catch (err) {
    showToast(err.message, true);
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'portal-modal-overlay';
  overlay.innerHTML = `
    <div class="portal-modal">
      <div class="portal-modal-head">
        <span>${escapeHtml(fileName)}</span>
        <button class="portal-modal-close" id="previewModalClose" aria-label="Close">&times;</button>
      </div>
      <div class="portal-modal-body" id="previewModalBody">
        <div class="portal-empty">Loading preview…</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let blobUrl = null;
  const close = () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    overlay.remove();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#previewModalClose').addEventListener('click', close);

  const body = overlay.querySelector('#previewModalBody');
  const ext = (extension || '').toLowerCase();

  if (!PREVIEWABLE_EXTENSIONS.includes(ext)) {
    body.innerHTML = `<div class="portal-empty">Preview isn't available for .${escapeHtml(ext || 'this')} files — use Download to view it. (Link expires ${formatDateTime(meta.expires_at)})</div>`;
    return;
  }

  try {
    const blob = await fetchFileBlob(docId, 'preview');
    blobUrl = URL.createObjectURL(blob);
    body.innerHTML = ext === 'pdf'
      ? `<iframe class="portal-preview-frame" src="${blobUrl}" title="${escapeHtml(fileName)}"></iframe>`
      : `<img class="portal-preview-image" src="${blobUrl}" alt="${escapeHtml(fileName)}" />`;
  } catch (err) {
    body.innerHTML = `<div class="portal-empty">${escapeHtml(err.message)}</div>`;
  }
}

// ── MessagesView ─────────────────────────────────────────────────────────
const MessagesView = {
  conversations: null,
  selectedId: null,

  async render(main, caseId) {
    const conversations = await Api.get('/conversations');
    this.conversations = conversations;
    if (!conversations.length) {
      main.innerHTML = viewHeader('Messages', 'Message your legal team about your case.') +
        '<div class="portal-empty">No conversations yet.</div>';
      return;
    }

    // A caseId in the URL (arrived via "Message About This Case" on a
    // case's detail page) selects that case's conversation, if it has one.
    const byCaseId = caseId && conversations.find(c => c.caseId === caseId);
    if (byCaseId) {
      this.selectedId = byCaseId.id;
    } else if (!this.selectedId || !conversations.find(c => c.id === this.selectedId)) {
      this.selectedId = conversations[0].id;
    }

    main.innerHTML = viewHeader('Messages', 'Message your legal team about your case.') + `
      <div class="portal-layout-split">
        <div class="portal-card portal-thread-list" id="threadList"></div>
        <div class="portal-card portal-thread-panel" id="threadPanel"></div>
      </div>`;

    this.renderThreadList();
    await this.renderThread();
  },

  renderThreadList() {
    // c.unread is already viewer-relative from the server (unread messages
    // FROM STAFF, for this CLIENT viewer) — see listConversationsForUser
    // in server/db.js. Don't reinterpret it here; just render the count.
    $('threadList').innerHTML = this.conversations.map(c => `
      <button class="portal-thread-item ${c.id === this.selectedId ? 'active' : ''}" data-id="${escapeHtml(c.id)}">
        <div class="portal-thread-item-top">
          <span class="portal-thread-name">${escapeHtml(c.caseName || 'General')}</span>
          ${c.unread ? '<span class="portal-unread-dot"></span>' : ''}
        </div>
        <div class="portal-thread-preview">${escapeHtml(c.preview || '')}</div>
      </button>`).join('');

    $('threadList').querySelectorAll('.portal-thread-item').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedId = btn.dataset.id;
        this.renderThreadList();
        this.renderThread();
      });
    });
  },

  async renderThread() {
    const panel = $('threadPanel');
    panel.innerHTML = '<div class="portal-empty">Loading…</div>';
    const conv = await Api.get(`/conversations/${encodeURIComponent(this.selectedId)}`);

    panel.innerHTML = `
      <div class="portal-thread-panel-head">${escapeHtml(conv.caseName || 'General')}</div>
      <div class="portal-thread-messages" id="threadMessages">
        ${conv.messages.map(m => `
          <div class="portal-msg ${m.sender === 'client' ? 'portal-msg-mine' : 'portal-msg-theirs'}">
            ${escapeHtml(m.text)}
            ${m.attachment ? `
              <a class="portal-msg-attachment" href="/api/v1/files/${encodeURIComponent(m.attachment.documentId)}/download"
                 target="_blank" rel="noopener">📎 ${escapeHtml(m.attachment.name)}</a>
            ` : ''}
            <span class="portal-msg-meta">${escapeHtml(m.sender === 'client' ? 'You' : (m.senderName || 'Staff'))} · ${escapeHtml(m.time || '')}</span>
          </div>`).join('') || '<div class="portal-empty">No messages yet.</div>'}
      </div>
      <form class="portal-thread-reply" id="replyForm">
        <textarea id="replyText" placeholder="Write a message…" required></textarea>
        <button type="submit" class="portal-btn-primary" id="replySendBtn">Send</button>
      </form>`;

    const messagesEl = $('threadMessages');
    messagesEl.scrollTop = messagesEl.scrollHeight;

    $('replyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const textarea = $('replyText');
      const text = textarea.value.trim();
      if (!text) return;
      const btn = $('replySendBtn');
      btn.disabled = true;
      try {
        await Api.post(`/conversations/${encodeURIComponent(this.selectedId)}/messages`, { text });
        textarea.value = '';
        await this.renderThread();
      } catch (err) {
        showToast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  }
};

// ── InvoicesView ─────────────────────────────────────────────────────────
const InvoicesView = {
  async render(main) {
    const invoices = await Api.get('/invoices');
    if (!invoices.length) {
      main.innerHTML = viewHeader('Invoices', 'Billing history across all of your matters.') +
        '<div class="portal-empty">No invoices on file.</div>';
      return;
    }

    main.innerHTML = viewHeader('Invoices', 'Billing history across all of your matters.') + `
      <div class="portal-card">
        <table class="portal-table">
          <thead>
            <tr><th>Invoice</th><th>Matter</th><th>Issued</th><th>Due</th><th>Status</th><th>Amount</th></tr>
          </thead>
          <tbody>${invoices.map(invoiceRow).join('')}</tbody>
        </table>
      </div>`;
  }
};

function invoiceRow(inv) {
  return `
    <tr>
      <td>${escapeHtml(inv.invoice_number)}</td>
      <td>${escapeHtml(inv.case_name || '—')}</td>
      <td>${formatDate(inv.issued_date)}</td>
      <td>${formatDate(inv.due_date)}</td>
      <td><span class="portal-badge status-${escapeHtml((inv.status || '').toLowerCase())}">${escapeHtml(inv.status)}</span></td>
      <td class="portal-amount">${formatMoney(inv.amount_cents)}</td>
    </tr>`;
}

// ── Shared view header ───────────────────────────────────────────────────
function viewHeader(title, subtitle) {
  return `<h1 class="portal-view-title">${escapeHtml(title)}</h1><p class="portal-view-subtitle">${escapeHtml(subtitle)}</p>`;
}

// ── Boot ─────────────────────────────────────────────────────────────────
// Staff-role users (or anyone with no session at all) don't belong here —
// bounced to the staff sign-in page, which itself redirects a CLIENT back
// to /portal on successful login (see app.js). Real enforcement is
// server-side on every API call above; this is a UX redirect only. There is
// no token this client can inspect directly (it's an HttpOnly cookie), so
// this always asks the server rather than gating on local state first.
async function boot() {
  try {
    const res = await fetch('/api/v1/auth/me');
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error('Session expired.');
    if (json.data.role !== 'CLIENT') { window.location.href = '/'; return; }

    Auth.setUser(json.data);
    renderShell(json.data);
    Router.init();
  } catch (err) {
    Auth.clearSession();
    window.location.href = '/';
  }
}

boot();
