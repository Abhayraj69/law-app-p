require('../env');

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('./pool');
const { runMigrations } = require('./migrate');

/**
 * Seed Script (npm run seed)
 *
 * (Re)creates the firm and demo users/cases/etc so local dev/demo still
 * works now that data lives in Postgres instead of resetting to fixtures
 * on every process restart. Safe to run multiple times — every insert is
 * an upsert keyed on a stable id or unique constraint.
 *
 * Each seed user gets its OWN password (never a shared default): pass
 * them via the SEED_*_PASSWORD env vars named below, or omit any of them
 * to have this script generate a random one and print it once — it is
 * never stored in plaintext or logged again after this run.
 *
 * Two of the seed users are CLIENT-role portal accounts (James Anderson,
 * Emily Davies), each attached via `client_user_id` to one case and one
 * conversation and NOT the other's — this is what
 * server/test/roleScoping.test.js exercises to prove a client can't read
 * another client's data.
 */

const DEFAULT_FIRM_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

// These ids are hardcoded so re-running the seed updates the same rows
// instead of creating duplicates. They must be syntactically valid UUIDs —
// users.id and folders.id are UUID columns, so an arbitrary label like
// "fld-root-1" is rejected by Postgres outright.
const SEED_USERS = [
  // The firm's practice administrator — the only role that can invite new
  // users (see server/services/inviteService.js). No other seed user has
  // the ADMIN role, so this account is required for the invite flow to be
  // reachable at all on a freshly seeded database.
  // defaultRateCents: prefills a new time entry's rate (see
  // db/migrations/0021_time_tracking_and_invoice_line_items.sql) — null
  // for CLIENT-role users, who never log billable time. Figures are a
  // plausible seniority ladder (partner > associate), not a real rate card.
  { id: 'a1100ac1-58cc-4372-a567-0e02b2c3d479', email: 'a.morgan@slf.law', fullName: 'Alex Morgan', role: 'ADMIN', initials: 'AM', envVar: 'SEED_MORGAN_PASSWORD', defaultRateCents: 45000 },
  { id: 'a1101ac1-58cc-4372-a567-0e02b2c3d479', email: 's.jennings@slf.law', fullName: 'Sarah Jennings', role: 'SENIOR_PARTNER', initials: 'SJ', envVar: 'SEED_JENNINGS_PASSWORD', defaultRateCents: 65000 },
  { id: 'a1102ac1-58cc-4372-a567-0e02b2c3d479', email: 'm.ross@slf.law', fullName: 'Marcus Ross', role: 'ASSOCIATE', initials: 'MR', envVar: 'SEED_ROSS_PASSWORD', defaultRateCents: 35000 },
  { id: 'a1103ac1-58cc-4372-a567-0e02b2c3d479', email: 'p.nair@slf.law', fullName: 'Priya Nair', role: 'ASSOCIATE', initials: 'PN', envVar: 'SEED_NAIR_PASSWORD', defaultRateCents: 32500 },
  { id: 'a1104ac1-58cc-4372-a567-0e02b2c3d479', email: 'j.anderson@client.slf.law', fullName: 'James Anderson', role: 'CLIENT', initials: 'JA', envVar: 'SEED_ANDERSON_PASSWORD', defaultRateCents: null },
  { id: 'a1105ac1-58cc-4372-a567-0e02b2c3d479', email: 'e.davies@client.slf.law', fullName: 'Emily Davies', role: 'CLIENT', initials: 'ED', envVar: 'SEED_DAVIES_PASSWORD', defaultRateCents: null }
];

const ATTORNEY_IDS = {
  jennings: 'a1101ac1-58cc-4372-a567-0e02b2c3d479',
  ross: 'a1102ac1-58cc-4372-a567-0e02b2c3d479',
  nair: 'a1103ac1-58cc-4372-a567-0e02b2c3d479'
};

const CLIENT_USER_IDS = {
  anderson: 'a1104ac1-58cc-4372-a567-0e02b2c3d479',
  davies: 'a1105ac1-58cc-4372-a567-0e02b2c3d479'
};

const FOLDER_IDS = {
  caseFiles: 'fd000001-0000-4000-8000-000000000001',
  templates: 'fd000002-0000-4000-8000-000000000002',
  secureShared: 'fd000003-0000-4000-8000-000000000003',
  archived: 'fd000004-0000-4000-8000-000000000004',
  activeCases: 'fd000005-0000-4000-8000-000000000005',
  closedCases: 'fd000006-0000-4000-8000-000000000006'
};

const SEED_FOLDERS = [
  { id: FOLDER_IDS.caseFiles, parentId: null, folderName: 'Case Files', category: 'Case Files' },
  { id: FOLDER_IDS.templates, parentId: null, folderName: 'Practice Templates', category: 'Practice Templates' },
  { id: FOLDER_IDS.secureShared, parentId: null, folderName: 'Secure Shared', category: 'Secure Shared' },
  { id: FOLDER_IDS.archived, parentId: null, folderName: 'Archived', category: 'Archived' },
  { id: FOLDER_IDS.activeCases, parentId: FOLDER_IDS.caseFiles, folderName: 'Active Cases', category: 'Case Files' },
  { id: FOLDER_IDS.closedCases, parentId: FOLDER_IDS.caseFiles, folderName: 'Closed Cases', category: 'Case Files' }
];

// client_user_id is set ONLY on Anderson's and Davies's cases — every
// other seed case deliberately has none, so listCasesForUser's role
// filter has both "belongs to this client" and "belongs to nobody" rows
// to prove it excludes correctly.
const SEED_CASES = [
  { id: 'LC-2026-001', caseName: 'Anderson v. Meridian Corp.', clientName: 'James Anderson', opposingParty: 'Meridian Corp.', opposingCounsel: 'Sterling & Croft', status: 'active', caseType: 'Commercial Litigation', leadAttorneyId: ATTORNEY_IDS.jennings, clientUserId: CLIENT_USER_IDS.anderson, description: 'Breach-of-contract claim against Meridian Corp. arising from their unilateral cancellation of a multi-year supply agreement. Seeking damages for lost revenue and reputational harm; settlement discussions are ongoing alongside trial preparation.' },
  { id: 'LC-2026-002', caseName: 'Davies v. State', clientName: 'Emily Davies', opposingParty: 'State Prosecutor', opposingCounsel: 'District Attorney Office', status: 'pending', caseType: 'Criminal Defense', leadAttorneyId: ATTORNEY_IDS.ross, clientUserId: CLIENT_USER_IDS.davies, description: 'Defense against state charges stemming from a traffic stop. Currently in the discovery phase; motion to suppress evidence obtained during the stop is under preparation.' },
  { id: 'LC-2026-004', caseName: 'Garrison Estate Management', clientName: 'Chloe Garrison', opposingParty: 'Garrison Trust Trustees', opposingCounsel: 'Hampton Law Firm', status: 'active', caseType: 'Probate & Estate', leadAttorneyId: ATTORNEY_IDS.nair, clientUserId: null, description: null },
  { id: 'LC-2026-005', caseName: 'Blake IP Dispute', clientName: 'FutureTech Inc.', opposingParty: 'Omni Media Group', opposingCounsel: 'Vanguard Legal Advisors', status: 'urgent', caseType: 'Intellectual Property', leadAttorneyId: ATTORNEY_IDS.ross, clientUserId: null, description: null }
];

// Deadline dates are computed relative to "today" (rather than hardcoded)
// so they still show up as upcoming hearings on the dashboard/cases pages
// no matter when this seed script is actually run.
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const SEED_DEADLINES = [
  { caseId: 'LC-2026-001', title: 'Anderson v. Meridian Corp.', location: 'Court 5D', deadlineDate: daysFromNow(20), timeText: '3:30 PM', badgeType: 'Hearing' },
  { caseId: 'LC-2026-002', title: 'Davies v. State', location: 'Court 3B', deadlineDate: daysFromNow(10), timeText: '10:00 AM', badgeType: 'Trial' },
  { caseId: 'LC-2026-004', title: 'Garrison Estate Management', location: 'Court 2C', deadlineDate: daysFromNow(24), timeText: '11:00 AM', badgeType: 'Hearing' },
  { caseId: 'LC-2026-005', title: 'Blake IP Dispute', location: 'Court 7A', deadlineDate: daysFromNow(17), timeText: '9:30 AM', badgeType: 'Filing' }
];

// Six months of invoices per case, mostly paid, with one deliberately
// overdue so the dashboard's overdue KPI and getMonthlyBillingTotals have
// real, non-empty data to aggregate.
const SEED_INVOICES = [
  { caseId: 'LC-2026-001', invoiceNumber: 'INV-2026-071', amountCents: 3800000, status: 'paid', issuedDate: '2026-02-10' },
  { caseId: 'LC-2026-002', invoiceNumber: 'INV-2026-072', amountCents: 4200000, status: 'paid', issuedDate: '2026-03-05' },
  { caseId: 'LC-2026-004', invoiceNumber: 'INV-2026-073', amountCents: 3100000, status: 'paid', issuedDate: '2026-04-12' },
  { caseId: 'LC-2026-001', invoiceNumber: 'INV-2026-074', amountCents: 5500000, status: 'paid', issuedDate: '2026-05-08' },
  { caseId: 'LC-2026-005', invoiceNumber: 'INV-2026-075', amountCents: 4800000, status: 'paid', issuedDate: '2026-06-15' },
  { caseId: 'LC-2026-002', invoiceNumber: 'INV-2026-076', amountCents: 5100000, status: 'paid', issuedDate: '2026-06-22' },
  { caseId: 'LC-2026-004', invoiceNumber: 'INV-2026-077', amountCents: 4400000, status: 'paid', issuedDate: '2026-07-03' },
  { caseId: 'LC-2026-005', invoiceNumber: 'INV-2026-084', amountCents: 840000, status: 'overdue', issuedDate: '2026-06-01', dueDate: '2026-06-30' }
];

// A handful of unbilled time entries so the "generate invoice from time
// entries" flow has real data to demonstrate on a fresh seed — deliberately
// left unbilled (not run through generateInvoiceFromTimeEntries here),
// since seeding an already-invoiced entry would also require seeding the
// invoice_line_item it points to, and that coupling belongs to the real
// generation path, not to fixture data.
const SEED_TIME_ENTRIES = [
  { caseId: 'LC-2026-001', userId: ATTORNEY_IDS.jennings, entryDate: daysFromNow(-3), minutes: 90, description: 'Reviewed Meridian contract amendments and drafted response memo.' },
  { caseId: 'LC-2026-001', userId: ATTORNEY_IDS.jennings, entryDate: daysFromNow(-2), minutes: 45, description: 'Client call re: settlement counter-offer strategy.' },
  { caseId: 'LC-2026-002', userId: ATTORNEY_IDS.ross, entryDate: daysFromNow(-4), minutes: 120, description: 'Prepared motion to suppress evidence from traffic stop.' },
  { caseId: 'LC-2026-005', userId: ATTORNEY_IDS.ross, entryDate: daysFromNow(-1), minutes: 60, description: 'IP dispute research — prior art search for Omni Media filing.' },
  { caseId: 'LC-2026-004', userId: ATTORNEY_IDS.nair, entryDate: daysFromNow(-5), minutes: 30, description: 'Reviewed Garrison trust documents for probate filing.' }
];

const CONVERSATION_IDS = {
  anderson: 'c0000001-0000-4000-8000-000000000001',
  davies: 'c0000002-0000-4000-8000-000000000002'
};

const SEED_CONVERSATIONS = [
  {
    id: CONVERSATION_IDS.anderson,
    caseId: 'LC-2026-001',
    clientUserId: CLIENT_USER_IDS.anderson,
    clientName: 'James Anderson',
    clientInitials: 'JA',
    clientColor: '#C9A84C',
    status: 'active',
    messages: [
      { sender: 'client', senderUserId: CLIENT_USER_IDS.anderson, body: 'Hi Sarah, did you get the copy of the contract signed by Meridian?' },
      { sender: 'staff', senderUserId: ATTORNEY_IDS.jennings, body: 'Yes, James. Our team has received it and uploaded it to the vault.' },
      { sender: 'note', senderUserId: ATTORNEY_IDS.jennings, body: 'Checked contract draft. Signature verified. Ready for filing tomorrow.' },
      { sender: 'client', senderUserId: CLIENT_USER_IDS.anderson, body: 'Perfect. Let me know when the settlement counter-offer is drafted.' }
    ]
  },
  {
    id: CONVERSATION_IDS.davies,
    caseId: 'LC-2026-002',
    clientUserId: CLIENT_USER_IDS.davies,
    clientName: 'Emily Davies',
    clientInitials: 'ED',
    clientColor: '#3B82F6',
    status: 'pending',
    messages: [
      { sender: 'staff', senderUserId: ATTORNEY_IDS.ross, body: 'Emily, we need the notarized deposition by end of week.' },
      { sender: 'client', senderUserId: CLIENT_USER_IDS.davies, body: 'I am signing them now and will upload them shortly.' },
      { sender: 'note', senderUserId: ATTORNEY_IDS.ross, body: 'Client will upload signed docs via portal. Follow up on Friday.' },
      { sender: 'client', senderUserId: CLIENT_USER_IDS.davies, body: 'Documents signed and uploaded. Please review.' }
    ]
  }
];

function generatePassword() {
  return crypto.randomBytes(12).toString('base64url'); // 16 printable chars
}

async function seedFirm(client) {
  await client.query(
    `INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [DEFAULT_FIRM_ID, 'Sterling Jennings & Partners LLP', 'slf.law']
  );
  await client.query(
    `INSERT INTO storage_quotas (firm_id, storage_limit_bytes, storage_used_bytes)
     VALUES ($1, 107374182400, 0)
     ON CONFLICT (firm_id) DO NOTHING`,
    [DEFAULT_FIRM_ID]
  );
}

async function seedUsers(client) {
  const printedCredentials = [];

  for (const u of SEED_USERS) {
    const existing = await client.query('SELECT id FROM users WHERE id = $1', [u.id]);
    const alreadyExists = existing.rowCount > 0;

    const providedPassword = process.env[u.envVar];
    const password = providedPassword || generatePassword();
    const passwordHash = bcrypt.hashSync(password, 10);

    await client.query(
      `INSERT INTO users (id, firm_id, email, full_name, role, initials, password_hash, default_rate_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         role = EXCLUDED.role,
         initials = EXCLUDED.initials,
         default_rate_cents = EXCLUDED.default_rate_cents
         ${providedPassword ? ', password_hash = EXCLUDED.password_hash' : ''}`,
      [u.id, DEFAULT_FIRM_ID, u.email, u.fullName, u.role, u.initials, passwordHash, u.defaultRateCents ?? null]
    );

    // Only print a password when we actually set one just now: either this
    // user didn't exist before (so this IS their initial password), or the
    // caller explicitly provided one via env var this run.
    if (!alreadyExists || providedPassword) {
      printedCredentials.push({ email: u.email, password: providedPassword ? '(set from env var)' : password });
    }
  }

  return printedCredentials;
}

async function seedFolders(client) {
  for (const f of SEED_FOLDERS) {
    await client.query(
      `INSERT INTO folders (id, firm_id, parent_id, folder_name, category)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [f.id, DEFAULT_FIRM_ID, f.parentId, f.folderName, f.category]
    );
  }
}

async function seedCases(client) {
  for (const c of SEED_CASES) {
    await client.query(
      `INSERT INTO cases (id, firm_id, case_name, client_name, opposing_party, opposing_counsel, status, case_type, lead_attorney_id, client_user_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         opposing_party = EXCLUDED.opposing_party,
         opposing_counsel = EXCLUDED.opposing_counsel,
         status = EXCLUDED.status,
         case_type = EXCLUDED.case_type,
         lead_attorney_id = EXCLUDED.lead_attorney_id,
         client_user_id = EXCLUDED.client_user_id,
         description = EXCLUDED.description`,
      [c.id, DEFAULT_FIRM_ID, c.caseName, c.clientName, c.opposingParty, c.opposingCounsel, c.status, c.caseType, c.leadAttorneyId, c.clientUserId, c.description]
    );
  }
}

async function seedDeadlines(client) {
  for (const d of SEED_DEADLINES) {
    const existing = await client.query(
      'SELECT id FROM case_deadlines WHERE firm_id = $1 AND case_id = $2 AND deadline_date = $3',
      [DEFAULT_FIRM_ID, d.caseId, d.deadlineDate]
    );
    if (existing.rowCount > 0) continue;
    await client.query(
      `INSERT INTO case_deadlines (firm_id, case_id, title, location, deadline_date, time_text, badge_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [DEFAULT_FIRM_ID, d.caseId, d.title, d.location, d.deadlineDate, d.timeText, d.badgeType]
    );
  }
}

async function seedInvoices(client) {
  for (const inv of SEED_INVOICES) {
    await client.query(
      `INSERT INTO invoices (firm_id, case_id, invoice_number, amount_cents, status, issued_date, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (firm_id, invoice_number) DO UPDATE SET
         amount_cents = EXCLUDED.amount_cents,
         status = EXCLUDED.status`,
      [DEFAULT_FIRM_ID, inv.caseId, inv.invoiceNumber, inv.amountCents, inv.status, inv.issuedDate, inv.dueDate || null]
    );
  }
}

async function seedTimeEntries(client) {
  const rateByUserId = Object.fromEntries(SEED_USERS.map(u => [u.id, u.defaultRateCents]));

  for (const t of SEED_TIME_ENTRIES) {
    const existing = await client.query(
      'SELECT id FROM time_entries WHERE firm_id = $1 AND case_id = $2 AND user_id = $3 AND entry_date = $4 AND description = $5',
      [DEFAULT_FIRM_ID, t.caseId, t.userId, t.entryDate, t.description]
    );
    if (existing.rowCount > 0) continue; // don't duplicate on re-run
    await client.query(
      `INSERT INTO time_entries (firm_id, case_id, user_id, entry_date, minutes, rate_cents, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [DEFAULT_FIRM_ID, t.caseId, t.userId, t.entryDate, t.minutes, rateByUserId[t.userId], t.description]
    );
  }
}

async function seedConversations(client) {
  for (const conv of SEED_CONVERSATIONS) {
    await client.query(
      `INSERT INTO conversations (id, firm_id, case_id, client_user_id, client_name, client_initials, client_color, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
      [conv.id, DEFAULT_FIRM_ID, conv.caseId, conv.clientUserId, conv.clientName, conv.clientInitials, conv.clientColor, conv.status]
    );

    const existingMessages = await client.query(
      'SELECT COUNT(*)::int AS n FROM conversation_messages WHERE conversation_id = $1',
      [conv.id]
    );
    if (existingMessages.rows[0].n > 0) continue; // don't duplicate messages on re-run

    // Deliberately still a raw plaintext insert (not
    // messageEncryption.encryptMessageBody / db.insertConversationMessage,
    // which now require encrypted columns) — this gives every freshly
    // seeded environment real legacy-plaintext rows, exercising exactly
    // the dual-read fallback (messageEncryptionService.resolveMessageBody)
    // and the backfill script (npm run backfill:encrypt-messages) are for.
    // See db/migrations/0006_message_encryption.sql's header for the full
    // migration plan this models.
    for (const m of conv.messages) {
      await client.query(
        `INSERT INTO conversation_messages (conversation_id, sender, sender_user_id, body)
         VALUES ($1, $2, $3, $4)`,
        [conv.id, m.sender, m.senderUserId, m.body]
      );
    }
  }
}

async function seed() {
  await runMigrations();

  const client = await pool.connect();
  try {
    await seedFirm(client);
    await seedFolders(client);
    const printed = await seedUsers(client); // must run before seedCases/seedConversations (FK to users.id)
    await seedCases(client);
    await seedDeadlines(client);
    await seedInvoices(client);
    await seedTimeEntries(client);
    await seedConversations(client);

    if (printed.length) {
      console.log('\n[SEED] Demo account credentials (shown once — store them now):');
      printed.forEach(({ email, password }) => console.log(`  ${email}  →  ${password}`));
      console.log('');
    } else {
      console.log('[SEED] All demo users already exist; no new passwords generated.');
    }

    console.log('[SEED] Firm, folders, users, cases, deadlines, invoices, time entries, and conversations are seeded.');
  } finally {
    client.release();
  }
}

module.exports = { seed, DEFAULT_FIRM_ID, SEED_USERS, CLIENT_USER_IDS, CONVERSATION_IDS };

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[SEED] Failed:', err.message);
      pool.end().finally(() => process.exit(1));
    });
}
