/* ═══════════════════════════════════════════════════
   SLF – app.js
   All interactivity, data, and dynamic rendering
   ═══════════════════════════════════════════════════ */

'use strict';

// ══════════════════════════════════════
// DATA LAYER
//
// STATUS: STATIC MOCK DATA, NOT WIRED TO THE BACKEND.
// CASES, HEARINGS, MESSAGES, ACTIVITIES, NOTIFICATIONS, SEARCH_DATA below,
// and CONVERSATIONS further down, are hardcoded fixtures that drive the
// Dashboard, Cases, and Communications pages. Unlike the Document Vault
// page and the AI Copilot drawer (which call the real /api/v1/... backend
// in server/), these pages never touch the server or the database — they
// only ever render this in-file data. See README.md for the full
// real-vs-mock breakdown before building on top of any of these pages.
// ══════════════════════════════════════

const CASES = [
  { 
    id: 'LC-2026-001', 
    name: 'Anderson v. Meridian Corp.', 
    client: 'James Anderson', 
    opposingParty: 'Meridian Corp.',
    opposingCounsel: 'Sterling & Croft',
    status: 'active',  
    attorney: 'Sarah J.', 
    initials: 'SJ', 
    color: '#C9A84C', 
    activity: '2 hrs ago',   
    type: 'Commercial Litigation',
    nextHearing: 'Jul 31, 2026',
    createdDate: new Date('2026-06-01')
  },
  { 
    id: 'LC-2026-002', 
    name: 'Davies v. State',           
    client: 'Emily Davies',   
    opposingParty: 'State Prosecutor',
    opposingCounsel: 'District Attorney Office',
    status: 'pending', 
    attorney: 'Marcus R.', 
    initials: 'MR', 
    color: '#3B82F6', 
    activity: '5 hrs ago',   
    type: 'Criminal Defense',
    nextHearing: 'Jul 21, 2026',
    createdDate: new Date('2026-06-05')
  },
  { 
    id: 'LC-2026-003', 
    name: 'Johnson Pre-trial Review',  
    client: 'Liam Johnson',   
    opposingParty: 'Rebecca Johnson',
    opposingCounsel: 'Corey & Associates LLC',
    status: 'pending', 
    attorney: 'Sarah J.', 
    initials: 'SJ', 
    color: '#C9A84C', 
    activity: '1 day ago',   
    type: 'Family Law',
    nextHearing: 'Jul 22, 2026',
    createdDate: new Date('2026-06-12')
  },
  { 
    id: 'LC-2026-004', 
    name: 'Garrison Estate Management',           
    client: 'Chloe Garrison', 
    opposingParty: 'Garrison Trust Trustees',
    opposingCounsel: 'Hampton Law Firm',
    status: 'active',  
    attorney: 'Priya N.', 
    initials: 'PN', 
    color: '#2DC8B0', 
    activity: '1 day ago',   
    type: 'Probate & Estate',
    nextHearing: 'Aug 04, 2026',
    createdDate: new Date('2026-05-18')
  },
  { 
    id: 'LC-2026-005', 
    name: 'Blake IP Dispute',          
    client: 'FutureTech Inc.', 
    opposingParty: 'Omni Media Group',
    opposingCounsel: 'Vanguard Legal Advisors',
    status: 'urgent', 
    attorney: 'Marcus R.', 
    initials: 'MR', 
    color: '#3B82F6', 
    activity: '2 days ago',  
    type: 'Intellectual Property',
    nextHearing: 'Jul 28, 2026',
    createdDate: new Date('2026-05-25')
  },
  { 
    id: 'LC-2026-006', 
    name: 'Torres v. City Council',   
    client: 'Rosa Torres',    
    opposingParty: 'Metro City Council',
    opposingCounsel: 'City Attorney Division',
    status: 'pending', 
    attorney: 'Sarah J.', 
    initials: 'SJ', 
    color: '#C9A84C', 
    activity: '2 days ago',  
    type: 'Administrative Law',
    nextHearing: 'Jul 25, 2026',
    createdDate: new Date('2026-06-20')
  },
  { 
    id: 'LC-2026-007', 
    name: 'Kimura Patent Filing',     
    client: 'Kimura Corp.',   
    opposingParty: 'US Patent Office',
    opposingCounsel: 'USPTO Examiner Office',
    status: 'active',  
    attorney: 'Priya N.', 
    initials: 'PN', 
    color: '#2DC8B0', 
    activity: '3 days ago',  
    type: 'Intellectual Property',
    nextHearing: 'Sep 10, 2026',
    createdDate: new Date('2026-06-28')
  },
  { 
    id: 'LC-2026-008', 
    name: 'Henley v. Nationwide Ins.', 
    client: 'David Henley',  
    opposingParty: 'Nationwide Insurance Co.',
    opposingCounsel: 'Lynch & Partners LLP',
    status: 'closed',  
    attorney: 'Marcus R.', 
    initials: 'MR', 
    color: '#3B82F6', 
    activity: '1 week ago',  
    type: 'Insurance Dispute',
    nextHearing: 'None',
    createdDate: new Date('2026-03-10')
  },
  { 
    id: 'LC-2026-009', 
    name: 'Rivera Wrongful Dismiss.',  
    client: 'Ana Rivera',    
    opposingParty: 'Apex Logistics Inc.',
    opposingCounsel: 'Dunbar & Croft LLP',
    status: 'active',  
    attorney: 'Sarah J.', 
    initials: 'SJ', 
    color: '#C9A84C', 
    
    activity: '1 week ago',  
    type: 'Employment Law',
    nextHearing: 'Aug 14, 2026',
    createdDate: new Date('2026-06-15')
  },
  { 
    id: 'LC-2026-010', 
    name: 'Nguyen Bankruptcy File',        
    client: 'Tom Nguyen',     
    opposingParty: 'First National Bank',
    opposingCounsel: 'Kramer & Davis P.C.',
    status: 'pending',  
    attorney: 'Priya N.', 
    initials: 'PN', 
    color: '#2DC8B0', 
    activity: '2 weeks ago', 
    type: 'Bankruptcy',
    nextHearing: 'Aug 19, 2026',
    createdDate: new Date('2026-07-02')
  },
  {
    id: 'LC-2026-011',
    name: 'Smyth v. Hamilton Trust',
    client: 'Arthur Smyth',
    opposingParty: 'Hamilton Trust Co.',
    opposingCounsel: 'Foster & Gedge Advocates',
    status: 'active',
    attorney: 'Marcus R.',
    initials: 'MR',
    color: '#3B82F6',
    activity: '3 days ago',
    type: 'Commercial Litigation',
    nextHearing: 'Aug 28, 2026',
    createdDate: new Date('2026-06-25')
  },
  {
    id: 'LC-2026-012',
    name: 'State v. Peterson',
    client: 'Michael Peterson',
    opposingParty: 'State of New York',
    opposingCounsel: 'District Attorney Division',
    status: 'urgent',
    attorney: 'Marcus R.',
    initials: 'MR',
    color: '#3B82F6',
    activity: '1 day ago',
    type: 'Criminal Defense',
    nextHearing: 'Jul 24, 2026',
    createdDate: new Date('2026-07-01')
  },
  {
    id: 'LC-2026-013',
    name: 'Harrison Child Custody',
    client: 'Linda Harrison',
    opposingParty: 'Robert Harrison',
    opposingCounsel: 'Weldon Law Group',
    status: 'active',
    attorney: 'Sarah J.',
    initials: 'SJ',
    color: '#C9A84C',
    activity: '4 days ago',
    type: 'Family Law',
    nextHearing: 'Sep 05, 2026',
    createdDate: new Date('2026-05-10')
  },
  {
    id: 'LC-2026-014',
    name: 'Vance Trust Audit',
    client: 'Gerald Vance',
    opposingParty: 'IRS Audit Board',
    opposingCounsel: 'Internal IRS Counsel',
    status: 'pending',
    attorney: 'Priya N.',
    initials: 'PN',
    color: '#2DC8B0',
    activity: '1 week ago',
    type: 'Probate & Estate',
    nextHearing: 'Aug 30, 2026',
    createdDate: new Date('2026-06-18')
  },
  {
    id: 'LC-2026-015',
    name: 'Novak Trademark Infringement',
    client: 'Novak Apparel LLC',
    opposingParty: 'Zaara Group Ltd.',
    opposingCounsel: 'Goldberg & Sons',
    status: 'active',
    attorney: 'Priya N.',
    initials: 'PN',
    color: '#2DC8B0',
    activity: '5 days ago',
    type: 'Intellectual Property',
    nextHearing: 'Oct 15, 2026',
    createdDate: new Date('2026-06-03')
  },
  {
    id: 'LC-2026-016',
    name: 'Zeller Zoning Challenge',
    client: 'Zeller Dev Corp.',
    opposingParty: 'Zoning Board of Appeals',
    opposingCounsel: 'Municipal Counsel',
    status: 'closed',
    attorney: 'Sarah J.',
    initials: 'SJ',
    color: '#C9A84C',
    activity: '3 weeks ago',
    type: 'Administrative Law',
    nextHearing: 'None',
    createdDate: new Date('2026-02-15')
  },
  {
    id: 'LC-2026-017',
    name: 'Gomez Class Action',
    client: 'Esteban Gomez',
    opposingParty: 'Transit Group Inc.',
    opposingCounsel: 'Phelps & Cole Counsel',
    status: 'active',
    attorney: 'Sarah J.',
    initials: 'SJ',
    color: '#C9A84C',
    activity: '2 days ago',
    type: 'Employment Law',
    nextHearing: 'Sep 22, 2026',
    createdDate: new Date('2026-05-30')
  },
  {
    id: 'LC-2026-018',
    name: 'Restructure of Zenith Corp.',
    client: 'Zenith Retail',
    opposingParty: 'Zenith Creditors Board',
    opposingCounsel: 'Deloitte Legal Services',
    status: 'pending',
    attorney: 'Priya N.',
    initials: 'PN',
    color: '#2DC8B0',
    activity: '6 days ago',
    type: 'Bankruptcy',
    nextHearing: 'Sep 02, 2026',
    createdDate: new Date('2026-06-20')
  }
];

const HEARINGS = [
  { day: 21, month: 'Jul', case: 'Davies v. State',           time: '10:00 AM', room: 'Court 3B',  type: 'urgent',   fullDate: new Date(2026, 6, 21) },
  { day: 22, month: 'Jul', case: 'Johnson Pre-trial Review',  time: '2:00 PM',  room: 'Chamber 1', type: 'normal',   fullDate: new Date(2026, 6, 22) },
  { day: 25, month: 'Jul', case: 'Torres v. City Council',    time: '9:30 AM',  room: 'Court 7A',  type: 'deadline', fullDate: new Date(2026, 6, 25) },
  { day: 28, month: 'Jul', case: 'Blake IP Dispute',          time: '11:00 AM', room: 'Court 2C',  type: 'normal',   fullDate: new Date(2026, 6, 28) },
  { day: 31, month: 'Jul', case: 'Anderson v. Meridian Corp.', time: '3:30 PM', room: 'Court 5D',  type: 'urgent',   fullDate: new Date(2026, 6, 31) },
];

const MESSAGES = [
  { initials: 'JA', name: 'James Anderson',   preview: '"Settlement counter-offer received"',     time: '9:14 AM',  unread: 2,  color: '#C9A84C', unreadItem: true },
  { initials: 'ED', name: 'Emily Davies',      preview: '"Documents signed and uploaded"',          time: '8:45 AM',  unread: 0,  color: '#3B82F6', unreadItem: true },
  { initials: 'LJ', name: 'Liam Johnson',     preview: '"Confirming Tuesday\'s hearing time"',      time: 'Yesterday', unread: 3, color: '#2DC8B0', unreadItem: true },
  { initials: 'CG', name: 'Chloe Garrison',   preview: '"Please review the attached will"',         time: 'Yesterday', unread: 0, color: '#9B59B6', unreadItem: false },
  { initials: 'AT', name: 'Ana Rivera',        preview: '"I have new evidence to submit"',           time: 'Mon',      unread: 0, color: '#F39C12', unreadItem: false },
];

const BILLING_DATA = [
  { month: 'Jan', value: 38000 }, { month: 'Feb', value: 42000 }, { month: 'Mar', value: 31000 },
  { month: 'Apr', value: 55000 }, { month: 'May', value: 48000 }, { month: 'Jun', value: 51000 },
  { month: 'Jul', value: 44000 },
];

const ACTIVITIES = [
  { icon: 'doc',     text: '<strong>New document uploaded</strong> – Pre-Trial Brief added to <strong>Davies v. State</strong>',       time: '12 min ago' },
  { icon: 'msg',     text: '<strong>James Anderson</strong> replied to your message in <strong>Anderson v. Meridian</strong>',          time: '47 min ago' },
  { icon: 'case',    text: 'Case status updated: <strong>Garrison Estate</strong> moved to <strong>Discovery Phase</strong>',           time: '2 hrs ago' },
  { icon: 'billing', text: 'Invoice #INV-2026-084 for <strong>$8,400</strong> marked as <strong>Paid</strong>',                         time: '4 hrs ago' },
  { icon: 'alert',   text: 'Deadline alert: Motion filing due in <strong>3 days</strong> – Torres v. City Council',                     time: '6 hrs ago' },
  { icon: 'doc',     text: 'Document reviewed: <strong>NDA Agreement</strong> approved by <strong>Priya N.</strong>',                   time: 'Yesterday' },
];

const NOTIFICATIONS = [
  { icon: 'alert', color: '#E74C3C', bgColor: 'rgba(231,76,60,0.15)', title: 'Urgent Hearing Tomorrow', desc: 'Davies v. State – Court 3B at 10:00 AM', time: '1 hour ago', unread: true },
  { icon: 'msg',   color: '#3B82F6', bgColor: 'rgba(59,130,246,0.15)', title: 'New Client Message',     desc: 'James Anderson sent a settlement counter-offer', time: '2 hours ago', unread: true },
  { icon: 'doc',   color: '#C9A84C', bgColor: 'rgba(201,168,76,0.15)', title: 'Document Needs Review',  desc: 'Garrison Estate – Will Amendment v3 uploaded', time: '3 hours ago', unread: true },
];

const SEARCH_DATA = [
  { type: 'case', icon: 'case', name: 'Anderson v. Meridian Corp.', meta: 'Active · Commercial Litigation' },
  { type: 'case', icon: 'case', name: 'Davies v. State', meta: 'Pending · Criminal Defense' },
  { type: 'client', icon: 'client', name: 'Emily Davies', meta: 'Client · 3 active cases' },
  { type: 'doc', icon: 'doc', name: 'Pre-Trial Brief – Davies', meta: 'Document · Uploaded today' },
  { type: 'doc', icon: 'doc', name: 'NDA Agreement – Kimura', meta: 'Document · Approved' },
  { type: 'client', icon: 'client', name: 'Liam Johnson', meta: 'Client · 1 active case' },
];

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════

const $ = (id) => document.getElementById(id);
const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

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
}

// Called once at startup: trust a stored token only after the server
// confirms it's still valid (not expired, user still exists).
async function initAuth() {
  const token = Auth.getToken();
  if (!token) {
    showAuthOverlay();
    return;
  }
  try {
    const res = await fetch('/api/v1/auth/me', { headers: Auth.authHeader() });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error || 'Session expired.');
    Auth.setSession(token, json.data);
    applyUserToChrome(json.data);
    hideAuthOverlay();
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
        applyUserToChrome(json.data.user);
        hideAuthOverlay();
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
    signOutBtn.addEventListener('click', (e) => {
      e.preventDefault();
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
    settings:       'Settings',
  };
  $('pageTitle').textContent = pageTitles[page] || 'Document Vault';

  const dashboardPage = $('dashboardPage');
  const casesPage = $('casesPage');
  const commsPage = $('commsPage');
  const documentsPage = $('documentsPage');
  const placeholder = $('placeholderPage');

  // Hide all main pages
  if (dashboardPage) dashboardPage.classList.add('hidden');
  if (casesPage) casesPage.classList.add('hidden');
  if (commsPage) commsPage.classList.add('hidden');
  if (documentsPage) documentsPage.classList.add('hidden');
  if (placeholder) placeholder.classList.add('hidden');

  if (page === 'dashboard') {
    if (dashboardPage) dashboardPage.classList.remove('hidden');
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
      <button class="btn-primary" onclick="navigateToPage('dashboard')">Return to Dashboard</button>
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
        <div class="notif-title">${n.title}</div>
        <div class="notif-desc">${n.desc}</div>
        <div class="notif-time">${n.time}</div>
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

function initSearch() {
  const input = $('globalSearch');
  const results = $('searchResults');

  const iconMap = {
    case:   '<path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>',
    client: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    doc:    '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>',
  };
  const colorMap = { case: '#C9A84C', client: '#3B82F6', doc: '#2DC8B0' };
  const bgMap    = { case: 'rgba(201,168,76,0.15)', client: 'rgba(59,130,246,0.15)', doc: 'rgba(45,200,176,0.15)' };

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.classList.remove('visible'); return; }

    const filtered = SEARCH_DATA.filter(d =>
      d.name.toLowerCase().includes(q) || d.meta.toLowerCase().includes(q)
    ).slice(0, 6);

    if (!filtered.length) { results.classList.remove('visible'); return; }

    results.innerHTML = filtered.map(d => `
      <div class="search-result-item">
        <div class="search-result-icon" style="background:${bgMap[d.type]}; color:${colorMap[d.type]}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${iconMap[d.icon]}</svg>
        </div>
        <div>
          <div class="result-name">${d.name}</div>
          <div class="result-meta">${d.meta}</div>
        </div>
      </div>
    `).join('');

    results.classList.add('visible');
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

      if (isCurrency) {
        el.textContent = current >= 1000 ? (current / 1000).toFixed(0) + ',000' : current;
      } else {
        el.textContent = current;
      }

      if (progress < 1) requestAnimationFrame(update);
      else {
        if (isCurrency) el.textContent = (target / 1000).toFixed(0) + ',600';
        else el.textContent = target;
      }
    }

    // Start after a short delay
    setTimeout(() => requestAnimationFrame(update), 300);
  });
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
        <div class="case-name" title="${c.name}">${c.name}</div>
        <div style="font-size:11px;color:var(--slate-400);margin-top:2px">${c.id}</div>
      </td>
      <td class="case-client">${c.client}</td>
      <td><span class="status-badge ${c.status}">${getStatusLabel(c.status)}</span></td>
      <td>
        <div class="attorney-cell">
          <div class="attorney-avatar" style="background:${c.color}22;color:${c.color}">${c.initials}</div>
          ${c.attorney}
        </div>
      </td>
      <td class="activity-time">${c.activity}</td>
      <td>
        <button class="row-action" aria-label="More actions for ${c.name}">
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

let calYear = 2026, calMonth = 6; // July = month index 6

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
        <div class="hearing-case">${h.case}</div>
        <div class="hearing-meta">${typeLabels[h.type]} · ${h.room}</div>
      </div>
      <div class="hearing-time">${h.time}</div>
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
      <div class="msg-avatar" style="background:${m.color}22; color:${m.color}">${m.initials}</div>
      <div class="message-content">
        <div class="message-name">${m.name}</div>
        <div class="message-preview">${m.preview}</div>
      </div>
      <div class="message-meta">
        <span class="message-time">${m.time}</span>
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
        <div class="activity-text">${a.text}</div>
        <div class="activity-time-tag">${a.time}</div>
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
  renderCasesList();
  setupCasesPageListeners();
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
          <div>${c.name}</div>
          <div class="case-id-sub">${c.id}</div>
        </td>
        <td class="client-name-cell">${c.client}</td>
        <td class="opposing-counsel-cell">
          <div>${c.opposingParty}</div>
          <div class="opposing-firm-sub">${c.opposingCounsel}</div>
        </td>
        <td>
          <span class="status-badge ${c.status}">${statusLabels[c.status] || c.status}</span>
        </td>
        <td class="activity-time">${c.nextHearing}</td>
        <td class="actions-cell-wrap">
          <button class="row-action-btn" aria-label="Actions for ${c.name}" onclick="toggleActionsDropdown(event, '${c.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
          <div class="actions-dropdown-menu" id="dropdown-${c.id}">
            <button class="actions-dropdown-item" onclick="handleCaseAction('open', '${c.id}', '${c.name}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
              Open Case File
            </button>
            <button class="actions-dropdown-item" onclick="handleCaseAction('upload', '${c.id}', '${c.name}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
              Upload to Document Index
            </button>
            <button class="actions-dropdown-item" onclick="handleCaseAction('message', '${c.id}', '${c.name}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              Message via Client Portal
            </button>
            <div style="height:1px; background:rgba(255,255,255,0.06); margin:4px 0;"></div>
            <button class="actions-dropdown-item danger-item" onclick="handleCaseAction('archive', '${c.id}', '${c.name}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;stroke:currentColor;margin-right:2px"><path d="M21 8v13a2 2 0 01-2 2H5a2 2 0 01-2-2V8M22 3H2v5h20V3zM10 12h4"/></svg>
              Archive Case
            </button>
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
      <button class="page-btn ${casesCurrentPage === i ? 'active' : ''}" onclick="setCasesPage(${i})">${i}</button>
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
  }
}

function handleNewCaseSubmit(e) {
  e.preventDefault();
  
  const title = $('newCaseTitle').value;
  const client = $('newCaseClient').value;
  const opposing = $('newCaseOpposing').value;
  const counsel = $('newCaseCounsel').value;
  const area = $('newCaseArea').value;
  const attorney = $('newCaseAttorney').value;
  const status = $('newCaseStatus').value;
  let hearing = $('newCaseHearing').value || 'None';
  
  const attyInfo = {
    'Sarah J.': { initials: 'SJ', color: '#C9A84C' },
    'Marcus R.': { initials: 'MR', color: '#3B82F6' },
    'Priya N.': { initials: 'PN', color: '#2DC8B0' }
  };
  
  const info = attyInfo[attorney] || { initials: 'XX', color: '#95A5A6' };
  const nextNum = CASES.length + 1;
  const newId = `LC-2026-${nextNum.toString().padStart(3, '0')}`;
  
  const newCase = {
    id: newId,
    name: title,
    client: client,
    opposingParty: opposing,
    opposingCounsel: counsel,
    status: status,
    attorney: attorney,
    initials: info.initials,
    color: info.color,
    activity: 'Just now',
    type: area,
    nextHearing: hearing,
    createdDate: new Date()
  };
  
  CASES.unshift(newCase);
  closeNewCaseModal();
  showToast(`Case ${newId} created successfully.`, 'success');
  
  renderCaseTable();
  renderCasesList();
  
  const activeCountEl = document.querySelector('.stat-card[data-animate] .stat-value');
  if (activeCountEl) {
    const currentTarget = parseInt(activeCountEl.dataset.target, 10);
    activeCountEl.dataset.target = currentTarget + 1;
    animateCountUp();
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

function handleCaseAction(action, caseId, caseName) {
  closeAllActionsDropdowns();
  if (action === 'open') {
    showToast(`Accessing secure repository for ${caseName} (${caseId}).`, 'info');
  } else if (action === 'upload') {
    showToast(`Initializing secure document ingest upload for ${caseId}.`, 'success');
  } else if (action === 'message') {
    showToast(`Opening client communications panel for ${caseName}.`, 'info');
  } else if (action === 'archive') {
    const confirmArchive = confirm(`Are you sure you want to archive case: ${caseName}?`);
    if (confirmArchive) {
      const idx = CASES.findIndex(c => c.id === caseId);
      if (idx !== -1) {
        CASES[idx].status = 'closed';
        showToast(`Case ${caseId} has been successfully archived.`, 'success');
        renderCaseTable();
        renderCasesList();
      }
    }
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
  toast.innerHTML = `
    <div style="width:6px;height:6px;border-radius:50%;background:${colors[type]};flex-shrink:0"></div>
    ${message}
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

document.addEventListener('DOMContentLoaded', () => {
  updateDate();
  initSidebar();
  initProfileDropdown();
  initNotifications();
  initSearch();
  initCaseTable();
  initCalendar();
  renderMessages();
  renderBillingChart();
  renderActivityFeed();
  initNewCaseButton();
  animateCountUp();

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

  // Show welcome toast
  setTimeout(() => showToast('Welcome back, Sarah! You have 3 urgent items.', 'info'), 800);
});

/* ════════════════════════════════════════════
   CLIENT COMMUNICATIONS DATA LAYER
   STATUS: static mock data, not wired to the backend (see the DATA LAYER
   note near the top of this file and README.md for the full picture).
   ════════════════════════════════════════════ */

const CONVERSATIONS = [
  {
    id: 'conv-1',
    caseId: 'LC-2026-001',
    clientName: 'James Anderson',
    caseName: 'Anderson v. Meridian Corp.',
    status: 'active',
    initials: 'JA',
    color: '#C9A84C',
    unread: 2,
    messages: [
      { sender: 'client', text: 'Hi Sarah, did you get the copy of the contract signed by Meridian?', time: '9:10 AM', isNote: false },
      { sender: 'staff', text: 'Yes, James. Our team has received it and uploaded it to the vault.', time: '9:12 AM', isNote: false },
      { sender: 'note', text: 'STAFF NOTE: Checked contract draft. Signature verified. Ready for filing tomorrow.', time: '9:13 AM', isNote: true },
      { sender: 'client', text: 'Perfect. Let me know when the settlement counter-offer is drafted.', time: '9:14 AM', isNote: false }
    ]
  },
  {
    id: 'conv-2',
    caseId: 'LC-2026-002',
    clientName: 'Emily Davies',
    caseName: 'Davies v. State',
    status: 'pending',
    initials: 'ED',
    color: '#3B82F6',
    unread: 0,
    messages: [
      { sender: 'staff', text: 'Emily, we need the notarized deposition by end of week.', time: 'Yesterday', isNote: false },
      { sender: 'client', text: 'I am signing them now and will upload them shortly.', time: 'Yesterday', isNote: false },
      { sender: 'note', text: 'STAFF NOTE: Client will upload signed docs via portal. Follow up on Friday.', time: 'Yesterday', isNote: true },
      { sender: 'client', text: 'Documents signed and uploaded. Please review.', time: '8:45 AM', isNote: false }
    ]
  },
  {
    id: 'conv-3',
    caseId: 'LC-2026-003',
    clientName: 'Liam Johnson',
    caseName: 'Johnson Pre-trial Review',
    status: 'pending',
    initials: 'LJ',
    color: '#2DC8B0',
    unread: 3,
    messages: [
      { sender: 'staff', text: 'Liam, the pre-trial conference is scheduled for Tuesday.', time: '2 days ago', isNote: false },
      { sender: 'client', text: 'Got it. Will we need to present any witness statements?', time: 'Yesterday', isNote: false },
      { sender: 'client', text: 'Confirming Tuesday\'s hearing time. Is it still 2:00 PM?', time: 'Yesterday', isNote: false },
      { sender: 'client', text: 'Please reply when free. Thanks!', time: 'Yesterday', isNote: false }
    ]
  },
  {
    id: 'conv-4',
    caseId: 'LC-2026-004',
    clientName: 'Chloe Garrison',
    caseName: 'Garrison Estate Management',
    status: 'active',
    initials: 'CG',
    color: '#9B59B6',
    unread: 0,
    messages: [
      { sender: 'client', text: 'Hi Sarah, can we add a clause to the will regarding the trust distribution?', time: '3 days ago', isNote: false },
      { sender: 'staff', text: 'Absolutely. We will draw up an amendment for your signature.', time: '2 days ago', isNote: false },
      { sender: 'client', text: 'Please review the attached will v3.', time: 'Yesterday', isNote: false }
    ]
  },
  {
    id: 'conv-5',
    caseId: 'LC-2026-009',
    clientName: 'Ana Rivera',
    caseName: 'Rivera Wrongful Dismiss.',
    status: 'active',
    initials: 'AR',
    color: '#F39C12',
    unread: 0,
    messages: [
      { sender: 'client', text: 'I have compiled the timesheets and email correspondence.', time: '4 days ago', isNote: false },
      { sender: 'staff', text: 'Excellent, this is vital evidence. We will add this to the discovery files.', time: '3 days ago', isNote: false },
      { sender: 'client', text: 'I have new evidence to submit. Let me know when we can talk.', time: 'Mon', isNote: false }
    ]
  }
];

/* ════════════════════════════════════════════
   CLIENT COMMUNICATIONS HUB CONTROLLER
   ════════════════════════════════════════════ */

let activeConvId = "conv-1";
let commsSearchQuery = "";
let commsListenersInitialized = false;

function initCommsPage() {
  renderCommsSidebar();
  renderActiveChat();
  setupCommsPageListeners();
}

function renderCommsSidebar() {
  const list = $('commsConvList');
  if (!list) return;

  const filtered = CONVERSATIONS.filter(c => {
    const q = commsSearchQuery.toLowerCase();
    return c.clientName.toLowerCase().includes(q) ||
           c.caseId.toLowerCase().includes(q) ||
           c.caseName.toLowerCase().includes(q);
  });

  list.innerHTML = filtered.map(c => {
    const lastMsg = c.messages[c.messages.length - 1];
    let previewText = lastMsg ? lastMsg.text : "No messages yet";
    if (lastMsg && lastMsg.isNote) {
      previewText = `[Note] ${lastMsg.text.replace('STAFF NOTE: ', '')}`;
    }
    
    return `
      <div class="comms-conv-item ${c.id === activeConvId ? 'active' : ''}" onclick="selectConversation('${c.id}')">
        <div class="conv-avatar" style="background:${c.color}22; color:${c.color}">
          ${c.initials}
        </div>
        <div class="conv-info">
          <div class="conv-header-row">
            <span class="conv-name">${c.clientName}</span>
            <span class="conv-case-id">${c.caseId}</span>
          </div>
          <div class="conv-header-row">
            <span class="conv-preview" title="${previewText}">${previewText}</span>
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
  
  header.innerHTML = `
    <div class="chat-header-left">
      <div class="chat-header-title">${conv.clientName}</div>
      <div class="chat-header-subtitle">
        <span>${conv.caseName}</span>
        <div style="width:4px;height:4px;border-radius:50%;background:var(--slate-400)"></div>
        <span class="status-badge ${conv.status}" style="font-size:10px; padding: 1px 6px;">${statusLabel}</span>
      </div>
    </div>
    <button class="comms-view-portal-btn" onclick="showToast('Loading Secure Client Portal...', 'info')">
      View Full Client Portal
    </button>
  `;

  stream.innerHTML = conv.messages.map(m => {
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
            <div>${m.text}</div>
          </div>
          <span class="message-meta">${m.time}</span>
        </div>
      `;
    } else if (m.sender === 'client') {
      return `
        <div class="message-row client-side">
          <div class="message-bubble">${m.text}</div>
          <span class="message-meta">${m.time}</span>
        </div>
      `;
    } else {
      return `
        <div class="message-row staff-side">
          <div class="message-bubble">${m.text}</div>
          <span class="message-meta">${m.time}</span>
        </div>
      `;
    }
  }).join('');

  setTimeout(() => {
    stream.scrollTop = stream.scrollHeight;
  }, 20);
}

function selectConversation(id) {
  activeConvId = id;
  const conv = CONVERSATIONS.find(c => c.id === id);
  if (conv) {
    conv.unread = 0;
  }
  renderCommsSidebar();
  renderActiveChat();
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

  commsListenersInitialized = true;
}

function handleSendCommsMessage(event) {
  event.preventDefault();
  const input = $('commsMessageInput');
  const toggle = $('internalNoteToggle');
  const text = input.value.trim();
  
  if (!text) return;

  const conv = CONVERSATIONS.find(c => c.id === activeConvId);
  if (!conv) return;

  const now = new Date();
  let timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const isNote = toggle.checked;
  const newMsg = {
    sender: isNote ? 'note' : 'staff',
    text: isNote ? `STAFF NOTE: ${text}` : text,
    time: timeStr,
    isNote: isNote
  };

  conv.messages.push(newMsg);
  input.value = '';
  input.style.height = 'auto';
  
  renderActiveChat();
  renderCommsSidebar();

  if (!isNote) {
    showToast('Secure Client Message Transmitted successfully.', 'success');
  } else {
    showToast('Internal Firm Note saved securely.', 'success');
  }
}

function handleInputQuickAction(action) {
  if (action === 'attach') {
    showToast('Loading Document Vault attachment picker...', 'info');
  } else if (action === 'signature') {
    showToast('Generating secure Signature Request template...', 'success');
  } else if (action === 'template') {
    showToast('Loading Quick Replies and legal templates...', 'info');
  }
}

/* ════════════════════════════════════════════
   DOCUMENT VAULT FULL INTERACTIVITY
   ════════════════════════════════════════════ */

const VaultState = {
  activeTab: 'Case Files',
  selectedFolderId: null,
  searchQuery: '',
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
    loadSidebarWidgets()
  ]);
  await loadVaultFiles();
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
    if (!json.success && res.status !== 413) throw new Error(json.error || 'API Error');
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
    if (!json.success && res.status !== 413) throw new Error(json.error || 'API Error');
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
  
  function buildHtml(nodes, level = 0) {
    return nodes.map(node => {
      const isSelected = VaultState.selectedFolderId === node.id;
      const hasChildren = (node.subfolders && node.subfolders.length) || (node.files && node.files.length);
      const subHtml = node.subfolders?.length ? `<div class="tree-children" style="padding-left:14px; display:block;">${buildHtml(node.subfolders, level + 1)}</div>` : '';
      
      const fileHtml = node.files?.length ? `
        <div class="tree-file-children" style="padding-left:24px; display:block;">
          ${node.files.map(f => `
            <div class="tree-file-item" onclick="handlePreview('${f.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="${f.extension === 'pdf' ? '#E74C3C' : '#3B82F6'}" stroke-width="2" class="doc-icon"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
              <span>${f.name}</span>
            </div>
          `).join('')}
        </div>
      ` : '';

      return `
        <div class="tree-item ${isSelected ? 'active-item' : ''}" onclick="selectFolder('${node.id}', '${node.name}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="arrow-icon" style="transform: ${hasChildren ? 'rotate(90deg)' : 'rotate(0)'}; opacity: ${hasChildren ? 1 : 0};"><path d="M9 18l6-6-6-6"/></svg>
          <svg viewBox="0 0 24 24" fill="none" stroke="${isSelected ? '#2DC8B0' : '#8A99AD'}" ${isSelected ? 'fill="rgba(45,200,176,0.2)"' : ''} stroke-width="2" class="folder-icon"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <span class="tree-label ${isSelected ? 'green-label' : ''}">${node.name}</span>
        </div>
        ${subHtml}
        ${fileHtml}
      `;
    }).join('');
  }
  
  container.innerHTML = buildHtml(VaultState.tree);
}

function selectFolder(folderId, folderName) {
  VaultState.selectedFolderId = folderId;
  VaultState.currentPage = 1;
  $('vaultBreadcrumb').innerHTML = `
    <span class="breadcrumb-item" onclick="resetFolder()">${VaultState.activeTab}</span>
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
      return `<span class="tag-badge ${tCls}">${t}</span>`;
    }).join('');

    return `
      <tr style="${doc.is_flagged ? 'border-left: 3px solid #E74C3C;' : ''}">
        <td class="col-chk"><input type="checkbox" value="${doc.id}" class="row-chk" ${isChecked ? 'checked' : ''} /></td>
        <td class="col-name" onclick="handlePreview('${doc.id}')" style="cursor:pointer">
          <div class="file-cell">
            <span class="file-icon-badge ${badgeCls}">${badgeText}</span>
            <span class="file-name-text">${doc.file_name}</span>
          </div>
        </td>
        <td class="col-case">${doc.case_name || '—'}</td>
        <td class="col-author">${doc.author_name}</td>
        <td class="col-date">${dateStr}</td>
        <td class="col-size">${sizeMb}</td>
        <td class="col-tags">${tagsHtml}</td>
        <td class="col-action" style="position:relative">
          <button class="doc-action-btn" onclick="openContextMenu(event, '${doc.id}')">
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
  html += `<button class="page-btn" ${VaultState.currentPage === 1 ? 'disabled' : ''} onclick="VaultState.currentPage--; loadVaultFiles()">&lt;</button>`;
  html += `<button class="page-btn" ${VaultState.currentPage >= totalPages ? 'disabled' : ''} onclick="VaultState.currentPage++; loadVaultFiles()">&gt;</button>`;
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
  $('btnUploadFiles').addEventListener('click', openUploadModal);
  $('btnIntegrations').addEventListener('click', () => {
    $('integrationsDrawerOverlay').classList.remove('hidden');
  });

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

function openUploadModal() {
  filesToUpload = [];
  renderUploadList();
  if (VaultState.stats) {
    const pct = Math.round((VaultState.stats.storage_used_bytes / VaultState.stats.storage_limit_bytes) * 100);
    $('uploadQuotaFill').style.width = `${pct}%`;
    $('uploadQuotaLabel').textContent = `${VaultState.stats.storage_used_formatted} / ${VaultState.stats.storage_limit_formatted}`;
  }
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
        <div class="upload-file-name">${f.file.name}</div>
        <div class="upload-file-size">${(f.file.size/(1024*1024)).toFixed(1)} MB - ${f.status}</div>
        <div class="upload-progress-bar">
          <div class="upload-progress-fill" style="width:${f.progress}%"></div>
        </div>
      </div>
      <button class="upload-file-remove" onclick="removeUploadFile(${i})">&times;</button>
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
      const formData = new FormData();
      formData.append('file', f.file);
      if (VaultState.selectedFolderId) formData.append('folder_id', VaultState.selectedFolderId);
      formData.append('tags', JSON.stringify([]));

      const res = await ApiClient.postForm('/api/v1/vault/upload', formData);
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
      <div class="deadline-item" style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:6px;border-left:3px solid ${d.badge_color || '#C9A84C'};cursor:pointer" onclick="showToast('${d.title.replace(/'/g, '')}','info')">
        <div style="font-size:10px;color:var(--slate-400);text-align:center;line-height:1.2;min-width:32px">
          <div style="font-size:11px;font-weight:600;color:var(--white)">${monthAbbr}</div>
          <div style="font-size:14px;font-weight:700;color:var(--white)">${dlDate.getDate()}</div>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:500;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.title}</div>
          <div style="font-size:10px;color:var(--slate-400);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.location} · ${d.time_text}</div>
        </div>
        <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:${d.badge_color || '#C9A84C'}22;color:${d.badge_color || '#C9A84C'};font-weight:600;text-transform:uppercase">${d.badge_type}</span>
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
        <div class="quick-item" onclick="handlePreview('${f.id}')" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:6px;transition:background .2s" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
          <span class="file-icon-badge" style="background:${color}22;color:${color};font-size:9px;padding:3px 6px;border-radius:4px;font-weight:600">${ext.toUpperCase()}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.file_name}</div>
            <div style="font-size:10px;color:var(--slate-400)">${f.case_id || '—'}</div>
          </div>
        </div>
      `;
    });
  }

  if (frequent_folders.length) {
    html += `<div class="quick-sec-label" style="font-size:10px;color:var(--slate-400);margin:14px 0 8px;text-transform:uppercase;letter-spacing:.5px">Frequent Folders</div>`;
    frequent_folders.forEach(f => {
      html += `
        <div class="quick-item" onclick="selectFolder('${f.id}','${(f.folder_name || '').replace(/'/g, '')}')" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:8px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:6px;transition:background .2s" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
          <svg viewBox="0 0 24 24" fill="none" stroke="#C9A84C" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.folder_name}</div>
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
      <div class="client-msg-card" onclick="navigateToPage('communications')" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:8px;margin-bottom:8px;transition:background .2s" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
        <div style="width:30px;height:30px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-weight:600;font-size:11px;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:12px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.client_name}${m.is_urgent ? ' <span style="color:#E74C3C;font-size:10px">⚠</span>' : ''}</div>
            <div style="font-size:10px;color:var(--slate-400);flex-shrink:0;margin-left:6px">${m.timestamp_text}</div>
          </div>
          <div style="font-size:11px;color:var(--slate-400);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${m.preview}</div>
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

let copilotActiveTool = 'chat';
let copilotSearchScope = 'all';
let copilotPendingApproval = null;

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
  hideApprovalOverlay();
}

function switchCopilotTool(tool) {
  copilotActiveTool = tool;
  $$('.copilot-tab-btn').forEach(btn => {
    const isActive = btn.dataset.tool === tool;
    btn.classList.toggle('active', isActive);
    btn.style.color = isActive ? 'var(--white)' : 'var(--slate-400)';
    btn.style.background = isActive ? 'rgba(155,89,182,.15)' : 'transparent';
  });
  $$('.copilot-panel').forEach(panel => panel.classList.add('hidden'));
  $(`copilot${tool.charAt(0).toUpperCase() + tool.slice(1)}Panel`)?.classList.remove('hidden');
  hideApprovalOverlay();
}

async function handleCopilotChat(prompt) {
  if (!prompt.trim()) return;

  appendChatMessage('user', prompt);
  $('copilotChatInput').value = '';

  // Show typing indicator
  const typingId = 'typing-' + Date.now();
  appendChatMessage('assistant', '<em>Thinking…</em>', typingId);

  try {
    // Simple intent detection based on keywords
    const lowerPrompt = prompt.toLowerCase();

    if (lowerPrompt.includes('search') || lowerPrompt.includes('find') || lowerPrompt.includes('look for')) {
      // Extract search terms after "search for" or "find"
      const searchTerms = prompt.replace(/^(search|find|look for)\s+(for\s+)?/i, '').trim();
      if (searchTerms) {
        await handleSearch(searchTerms);
        removeChatMessage(typingId);
        return;
      }
    }

    if (lowerPrompt.includes('summarize') || lowerPrompt.includes('summary')) {
      // Extract document name
      const docName = prompt.replace(/^(summarize|summary)\s+(of\s+)?/i, '').trim();
      if (docName) {
        await handleSummarize(docName);
        removeChatMessage(typingId);
        return;
      }
    }

    if (lowerPrompt.includes('deadline') || lowerPrompt.includes('upcoming')) {
      const data = await ApiClient.get('/api/v1/vault/deadlines');
      const upcoming = data.upcoming?.slice(0, 5) || [];
      let response = upcoming.length
        ? `Here are your upcoming deadlines:\n\n${upcoming.map(d => `• **${d.title}** — ${d.deadline_date} (${d.location})`).join('\n')}`
        : 'No upcoming deadlines found.';
      removeChatMessage(typingId);
      appendChatMessage('assistant', response);
      return;
    }

    if (lowerPrompt.includes('flag') || lowerPrompt.includes('review')) {
      // This would invoke manageFiles with tag action
      removeChatMessage(typingId);
      appendChatMessage('assistant', 'I can help you tag documents for review. Please use the **Search** tab to find specific documents, then use the **Manage Files** tool to add the "REVIEW" tag. Would you like me to search for documents by a specific attorney or case first?');
      return;
    }

    // Default: search the vault
    const results = await ApiClient.post('/api/v1/copilot/search', { query: prompt, scope: 'all', limit: 5 });
    removeChatMessage(typingId);

    if (results.data?.results?.length) {
      const topResults = results.data.results.slice(0, 3);
      let response = `I found ${results.data.total} results. Here are the top matches:\n\n`;
      topResults.forEach(r => {
        response += `• **${r.title}** (${r.type}) — ${r.meta}\n  ${r.snippet}\n\n`;
      });
      response += 'Switch to the **Search** tab for full results with filters.';
      appendChatMessage('assistant', response);
    } else {
      appendChatMessage('assistant', 'I couldn\'t find anything matching that query. Try using the **Search** tab with different keywords or scopes.');
    }
  } catch (err) {
    removeChatMessage(typingId);
    console.error('Copilot chat error:', err);
    appendChatMessage('assistant', `Sorry, I encountered an error: ${err.message}`);
  }
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

async function handleSearch(query) {
  try {
    const data = await ApiClient.post('/api/v1/copilot/search', { query, scope: copilotSearchScope, limit: 20 });
    renderSearchResults(data);
  } catch (err) {
    console.error('Search error:', err);
    const resultsContainer = $('copilotSearchResults');
    if (resultsContainer) {
      resultsContainer.innerHTML = `<div style="text-align:center;padding:20px;color:#E74C3C">Search failed: ${err.message}</div>`;
    }
  }
}

function renderSearchResults(data) {
  const container = $('copilotSearchResults');
  if (!container) return;

  const results = data.data?.results || [];
  const total = data.data?.total || 0;

  if (!results.length) {
    container.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--slate-400);font-size:13px">No results found for "${data.data?.query || ''}"</div>`;
    return;
  }

  const typeIcons = {
    document: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    folder: '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>',
    case: '<path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>',
    message: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>'
  };

  const typeColors = {
    document: '#2DC8B0',
    folder: '#C9A84C',
    case: '#3B82F6',
    message: '#F39C12'
  };

  container.innerHTML = results.map(r => `
    <div class="search-result-item" style="display:flex;gap:10px;padding:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:8px;cursor:pointer;transition:all .15s"
         onmouseover="this.style.background='rgba(255,255,255,0.06)'"
         onmouseout="this.style.background='rgba(255,255,255,0.03)'"
         onclick="handleSearchResultClick('${r.type}', '${r.id}')">
      <div style="width:32px;height:32px;border-radius:6px;background:${typeColors[r.type] || '#8A99AD'}22;color:${typeColors[r.type] || '#8A99AD'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px">${typeIcons[r.type] || ''}</svg>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--white);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.title}</div>
        <div style="font-size:10px;color:var(--slate-400);margin-top:2px">${r.meta}</div>
        <div style="font-size:11px;color:var(--slate-500);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.snippet}</div>
      </div>
      <span style="font-size:9px;padding:2px 8px;border-radius:12px;background:${typeColors[r.type] || '#8A99AD'}22;color:${typeColors[r.type] || '#8A99AD'};font-weight:600;text-transform:uppercase">${r.type}</span>
    </div>
  `).join('');
}

function handleSearchResultClick(type, id) {
  if (type === 'document') {
    // Switch to summarize tab and auto-fill
    switchCopilotTool('summarize');
    $('copilotSummarizeInput').value = id;
    handleSummarize(id);
  } else if (type === 'case') {
    showToast(`Opening case ${id}...`, 'info');
    // Could navigate to case view
  }
}

async function handleSummarize(documentId) {
  const container = $('copilotSummaryResult');
  if (!container) return;

  container.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--slate-400)">Generating summary…</div>`;

  try {
    const data = await ApiClient.post('/api/v1/copilot/summarize', { document_id: documentId });
    renderSummary(data);
  } catch (err) {
    console.error('Summarize error:', err);
    container.innerHTML = `<div style="text-align:center;padding:40px 0;color:#E74C3C">Failed to summarize: ${err.message}</div>`;
  }
}

function renderSummary(data) {
  const container = $('copilotSummaryResult');
  if (!container) return;

  const { file_name, file_type, case_name, author_name, tags, size_mb, updated_at, executive_summary, key_points } = data.data || {};

  container.innerHTML = `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:10px;padding:16px">
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px">
        <div style="width:40px;height:40px;border-radius:8px;background:rgba(45,200,176,.15);color:#2DC8B0;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
        </div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600;color:var(--white)">${file_name}</div>
          <div style="font-size:11px;color:var(--slate-400);margin-top:2px">${file_type?.toUpperCase()} · ${size_mb} MB · ${new Date(updated_at).toLocaleDateString()}</div>
        </div>
      </div>

      <div style="margin-bottom:16px;padding:12px;background:rgba(155,89,182,.1);border-radius:8px;border-left:3px solid #9B59B6">
        <div style="font-size:10px;color:#9B59B6;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Executive Summary</div>
        <div style="font-size:12px;color:var(--slate-300);line-height:1.6">${executive_summary}</div>
      </div>

      <div>
        <div style="font-size:10px;color:var(--slate-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Key Points</div>
        <ul style="font-size:12px;color:var(--slate-300);line-height:1.8;padding-left:18px">
          ${(key_points || []).map(p => `<li>${p}</li>`).join('')}
        </ul>
      </div>

      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        ${(tags || []).map(t => `<span style="font-size:10px;padding:3px 8px;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);color:var(--slate-300)">${t}</span>`).join('')}
      </div>
    </div>
  `;
}

// ── HITL APPROVAL FLOW ──

let copilotPendingExecutablePayload = null;

function showApprovalOverlay(approvalData) {
  // Store the executable payload separately from the display payload
  copilotPendingApproval = approvalData;
  copilotPendingExecutablePayload = {
    tool: approvalData.tool,
    action: approvalData.action,
    target_id: approvalData.target_id,
    target_type: approvalData.target_type,
    payload: approvalData.executable_payload,  // the real executable payload
    case_id: approvalData.case_id
  };
  const overlay = $('copilotApprovalOverlay');
  if (!overlay) return;

  $('approvalTitle').textContent = `Confirm ${approvalData.action} on "${approvalData.target_name}"`;
  $('approvalMessage').textContent = approvalData.message;
  $('approvalTool').textContent = `Tool: ${approvalData.tool}`;
  $('approvalAction').textContent = `Action: ${approvalData.action}`;
  $('approvalTarget').textContent = `Target: ${approvalData.target_name} (${approvalData.target_type})`;
  $('approvalPayload').textContent = JSON.stringify(approvalData.proposed_payload, null, 2);

  overlay.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('active'), 10);
}

function hideApprovalOverlay() {
  const overlay = $('copilotApprovalOverlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  setTimeout(() => overlay.classList.add('hidden'), 200);
  copilotPendingApproval = null;
  copilotPendingExecutablePayload = null;
}

async function handleApprovalConfirm() {
  if (!copilotPendingExecutablePayload) return;

  const { tool, action, target_id, target_type, payload, case_id } = copilotPendingExecutablePayload;
  const confirmBtn = $('approvalConfirm');
  const originalText = confirmBtn.textContent;
  confirmBtn.textContent = 'Executing…';
  confirmBtn.disabled = true;

  try {
    let endpoint, body;

    if (tool === 'manageFiles') {
      endpoint = '/api/v1/copilot/manage-files';
      body = { action, target_id, target_type, payload, approved: true };
    } else if (tool === 'createOrUpdateCase') {
      endpoint = '/api/v1/copilot/cases';
      body = { case_id, payload, approved: true };
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...Auth.authHeader() },
      body: JSON.stringify(body)
    });
    if (res.status === 401) { handleUnauthenticated(); return; }
    const json = await res.json();

    if (json.success) {
      showToast(`Action completed: ${json.data?.result ? JSON.stringify(json.data.result) : 'Success'}`, 'success');
      hideApprovalOverlay();

      // Refresh relevant views
      if (tool === 'manageFiles') {
        loadVaultFiles?.();
        loadVaultStats?.();
      }
    } else {
      throw new Error(json.error || 'Action failed');
    }
  } catch (err) {
    console.error('Approval error:', err);
    showToast(`Failed: ${err.message}`, 'error');
  } finally {
    confirmBtn.textContent = originalText;
    confirmBtn.disabled = false;
  }
}

function handleApprovalCancel() {
  hideApprovalOverlay();
  showToast('Action cancelled', 'info');
}

// ════════════════════════════════════════════════════════════════════════════
// MANAGE FILES PANEL LOGIC
// ════════════════════════════════════════════════════════════════════════════

let currentManageAction = 'move';

function switchManageAction(action) {
  currentManageAction = action;
  $$('.action-btn').forEach(btn => {
    const active = btn.dataset.action === action;
    btn.classList.toggle('active', active);
    btn.style.background = active ? 'rgba(155,89,182,.15)' : 'rgba(255,255,255,0.03)';
    btn.style.borderColor = active ? 'rgba(155,89,182,.3)' : 'rgba(255,255,255,0.06)';
    btn.style.color = active ? '#9B59B6' : 'var(--slate-300)';
  });
  renderManageActionFields();
}

function renderManageActionFields() {
  const container = $('manageActionFields');
  const targetType = $('manageTargetType')?.value || 'file';
  if (!container) return;

  let html = '';

  switch (currentManageAction) {
    case 'move':
      html = `
        <div style="display:flex;flex-direction:column;gap:4px">
          <label style="font-size:11px;color:var(--slate-400)">Destination Folder ID</label>
          <input type="text" id="manageFolderId" placeholder="e.g. folder-201" style="padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;color:var(--white);font-size:12px" required />
        </div>
      `;
      break;
    case 'rename':
      html = `
        <div style="display:flex;flex-direction:column;gap:4px">
          <label style="font-size:11px;color:var(--slate-400)">New Name</label>
          <input type="text" id="manageNewName" placeholder="e.g. Updated_Document.pdf" style="padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;color:var(--white);font-size:12px" required />
        </div>
      `;
      break;
    case 'tag':
      html = `
        <div style="display:flex;flex-direction:column;gap:4px">
          <label style="font-size:11px;color:var(--slate-400)">Tags to Add (comma-separated)</label>
          <input type="text" id="manageAddTags" placeholder="e.g. CONFIDENTIAL, REVIEW, URGENT" style="padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;color:var(--white);font-size:12px" />
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <label style="font-size:11px;color:var(--slate-400)">Tags to Remove (comma-separated)</label>
          <input type="text" id="manageRemoveTags" placeholder="e.g. DRAFT, ARCHIVE" style="padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:6px;color:var(--white);font-size:12px" />
        </div>
      `;
      break;
    case 'delete':
      html = `
        <div style="display:flex;flex-direction:column;gap:4px">
          <label style="font-size:11px;color:var(--slate-400);display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="managePermanent" style="width:16px;height:16px" />
            Permanent delete (cannot be undone)
          </label>
        </div>
      `;
      break;
  }

  container.innerHTML = html;
}

async function handleManageFilesSubmit() {
  const targetId = $('manageTargetId')?.value?.trim();
  const targetType = $('manageTargetType')?.value || 'file';

  if (!targetId) {
    showToast('Please enter a Target ID', 'error');
    return;
  }

  let payload = {};

  switch (currentManageAction) {
    case 'move': {
      const folderId = $('manageFolderId')?.value?.trim();
      if (!folderId) {
        showToast('Destination Folder ID is required', 'error');
        return;
      }
      payload = { folder_id: folderId };
      break;
    }
    case 'rename': {
      const newName = $('manageNewName')?.value?.trim();
      if (!newName) {
        showToast('New name is required', 'error');
        return;
      }
      payload = { new_name: newName };
      break;
    }
    case 'tag': {
      const addTags = ($('manageAddTags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      const removeTags = ($('manageRemoveTags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      payload = { add_tags: addTags, remove_tags: removeTags };
      break;
    }
    case 'delete': {
      const permanent = $('managePermanent')?.checked || false;
      payload = { permanent };
      break;
    }
  }

  // Call the API with approved: false to get the HITL approval card
  // Include executable_payload so the approval confirm can execute it
  try {
    const res = await fetch('/api/v1/copilot/manage-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...Auth.authHeader() },
      body: JSON.stringify({
        action: currentManageAction,
        target_id: targetId,
        target_type: targetType,
        payload: payload,
        approved: false,
        executable_payload: payload
      })
    });
    if (res.status === 401) { handleUnauthenticated(); return; }
    const json = await res.json();

    if (json.success && json.requires_approval) {
      // Show the approval overlay
      showApprovalOverlay(json.data);
    } else if (json.success) {
      showToast('Action completed: ' + JSON.stringify(json.data?.result || {}), 'success');
      loadVaultFiles?.();
      loadVaultStats?.();
    } else {
      throw new Error(json.error || 'Request failed');
    }
  } catch (err) {
    console.error('Manage Files error:', err);
    showToast('Failed: ' + err.message, 'error');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CASES PANEL LOGIC
// ════════════════════════════════════════════════════════════════════════════

async function handleCasesSubmit() {
  const caseId = $('caseIdInput')?.value?.trim();

  if (!caseId) {
    showToast('Please enter a Case ID', 'error');
    return;
  }

  const payload = {};
  const status = $('caseStatusInput')?.value?.trim();
  const leadAttorney = $('caseAttorneyInput')?.value?.trim();
  const updateSubject = $('caseUpdateSubject')?.value?.trim();
  const updateBody = $('caseUpdateBody')?.value?.trim();
  const urgent = $('caseUpdateUrgent')?.checked || false;

  if (status) payload.status = status;
  if (leadAttorney) payload.lead_attorney = leadAttorney;
  if (updateSubject || updateBody) {
    payload.client_update = {
      subject: updateSubject || 'Case Update',
      body: updateBody || '',
      urgent: urgent
    };
  }

  // Call the API with approved: false to get the HITL approval card
  // Include executable_payload so the approval confirm can execute it
  try {
    const res = await fetch('/api/v1/copilot/cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...Auth.authHeader() },
      body: JSON.stringify({
        case_id: caseId,
        payload: payload,
        approved: false,
        executable_payload: payload
      })
    });
    if (res.status === 401) { handleUnauthenticated(); return; }
    const json = await res.json();

    if (json.success && json.requires_approval) {
      // Show the approval overlay
      showApprovalOverlay(json.data);
    } else if (json.success) {
      showToast('Case update completed', 'success');
    } else {
      throw new Error(json.error || 'Request failed');
    }
  } catch (err) {
    console.error('Cases error:', err);
    showToast('Failed: ' + err.message, 'error');
  }
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

  // Tab switching
  $$('.copilot-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchCopilotTool(btn.dataset.tool));
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

  // Search scope buttons
  $$('.scope-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      copilotSearchScope = btn.dataset.scope;
      $$('.scope-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('active', active);
        b.style.background = active ? 'rgba(155,89,182,.15)' : 'rgba(255,255,255,0.03)';
        b.style.borderColor = active ? 'rgba(155,89,182,.3)' : 'rgba(255,255,255,0.06)';
        b.style.color = active ? '#9B59B6' : 'var(--slate-300)';
      });
    });
  });

  // Search panel
  $('copilotSearchBtn')?.addEventListener('click', () => {
    const input = $('copilotSearchInput');
    if (input?.value?.trim()) handleSearch(input.value.trim());
  });

  $('copilotSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const input = $('copilotSearchInput');
      if (input?.value?.trim()) handleSearch(input.value.trim());
    }
  });

  // Summarize panel
  $('copilotSummarizeBtn')?.addEventListener('click', () => {
    const input = $('copilotSummarizeInput');
    if (input?.value?.trim()) handleSummarize(input.value.trim());
  });

  $('copilotSummarizeInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const input = $('copilotSummarizeInput');
      if (input?.value?.trim()) handleSummarize(input.value.trim());
    }
  });

  // Manage Files panel - action buttons
  $$('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => switchManageAction(btn.dataset.action));
  });

  // Manage Files panel - target type change
  $('manageTargetType')?.addEventListener('change', () => renderManageActionFields());

  // Manage Files panel - submit
  $('manageFilesSubmit')?.addEventListener('click', handleManageFilesSubmit);

  // Cases panel - submit
  $('casesSubmit')?.addEventListener('click', handleCasesSubmit);

  // Approval buttons
  $('approvalConfirm')?.addEventListener('click', handleApprovalConfirm);
  $('approvalCancel')?.addEventListener('click', handleApprovalCancel);

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

// Hook into existing DOMContentLoaded
const originalInit = document.addEventListener('DOMContentLoaded', () => {
  updateDate();
  initSidebar();
  initProfileDropdown();
  initNotifications();
  initSearch();
  initCaseTable();
  initCalendar();
  renderMessages();
  renderBillingChart();
  renderActivityFeed();
  initNewCaseButton();
  animateCountUp();
  initCopilot();

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

  // Show welcome toast
  setTimeout(() => showToast('Welcome back, Sarah! You have 3 urgent items.', 'info'), 800);
});
