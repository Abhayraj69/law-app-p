const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('./pool');
const { runMigrations } = require('./migrate');

/**
 * Seed Script (npm run seed)
 *
 * (Re)creates the firm and the three demo users so local dev/demo still
 * works now that data lives in Postgres instead of resetting to fixtures
 * on every process restart. Safe to run multiple times — every insert is
 * an upsert keyed on a stable id or unique constraint.
 *
 * Each seed user gets its OWN password (never a shared default): pass
 * them via SEED_JENNINGS_PASSWORD / SEED_ROSS_PASSWORD / SEED_NAIR_PASSWORD,
 * or omit any of them to have this script generate a random one and print
 * it once — it is never stored in plaintext or logged again after this run.
 */

const DEFAULT_FIRM_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

const SEED_USERS = [
  { id: 'u101ac10b-58cc-4372-a567-0e02b2c3d479', email: 's.jennings@slf.law', fullName: 'Sarah Jennings', role: 'SENIOR_PARTNER', initials: 'SJ', envVar: 'SEED_JENNINGS_PASSWORD' },
  { id: 'u102ac10b-58cc-4372-a567-0e02b2c3d479', email: 'm.ross@slf.law', fullName: 'Marcus Ross', role: 'ASSOCIATE', initials: 'MR', envVar: 'SEED_ROSS_PASSWORD' },
  { id: 'u103ac10b-58cc-4372-a567-0e02b2c3d479', email: 'p.nair@slf.law', fullName: 'Priya Nair', role: 'ASSOCIATE', initials: 'PN', envVar: 'SEED_NAIR_PASSWORD' }
];

const SEED_FOLDERS = [
  { id: 'fld-root-1', parentId: null, folderName: 'Case Files', category: 'Case Files' },
  { id: 'fld-root-2', parentId: null, folderName: 'Practice Templates', category: 'Practice Templates' },
  { id: 'fld-root-3', parentId: null, folderName: 'Secure Shared', category: 'Secure Shared' },
  { id: 'fld-root-4', parentId: null, folderName: 'Archived', category: 'Archived' },
  { id: 'fld-sub-1', parentId: 'fld-root-1', folderName: 'Active Cases', category: 'Case Files' },
  { id: 'fld-sub-2', parentId: 'fld-root-1', folderName: 'Closed Cases', category: 'Case Files' }
];

const SEED_CASES = [
  { id: 'LC-2026-001', caseName: 'Anderson v. Meridian Corp.', clientName: 'James Anderson' },
  { id: 'LC-2026-002', caseName: 'Davies v. State', clientName: 'Davies Family Trust' },
  { id: 'LC-2026-004', caseName: 'Garrison Estate Management', clientName: 'Chloe Garrison' },
  { id: 'LC-2026-005', caseName: 'Blake IP Dispute', clientName: 'Blake Technologies' }
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
      `INSERT INTO users (id, firm_id, email, full_name, role, initials, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         role = EXCLUDED.role,
         initials = EXCLUDED.initials
         ${providedPassword ? ', password_hash = EXCLUDED.password_hash' : ''}`,
      [u.id, DEFAULT_FIRM_ID, u.email, u.fullName, u.role, u.initials, passwordHash]
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
      `INSERT INTO cases (id, firm_id, case_name, client_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [c.id, DEFAULT_FIRM_ID, c.caseName, c.clientName]
    );
  }
}

async function seed() {
  await runMigrations();

  const client = await pool.connect();
  try {
    await seedFirm(client);
    await seedFolders(client);
    await seedCases(client);
    const printed = await seedUsers(client);

    if (printed.length) {
      console.log('\n[SEED] Demo account credentials (shown once — store them now):');
      printed.forEach(({ email, password }) => console.log(`  ${email}  →  ${password}`));
      console.log('');
    } else {
      console.log('[SEED] All demo users already exist; no new passwords generated.');
    }

    console.log('[SEED] Firm, folders, cases, and users are seeded.');
  } finally {
    client.release();
  }
}

module.exports = { seed, DEFAULT_FIRM_ID, SEED_USERS };

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[SEED] Failed:', err.message);
      pool.end().finally(() => process.exit(1));
    });
}
