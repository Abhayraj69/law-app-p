/**
 * Manual court-data provider — the only provider this app ships today.
 * No licensed vendor contract is signed yet (see 0026_court_sync.sql's
 * header), so there is nothing to call: `fetchCaseStatus` always refuses,
 * telling the caller a real vendor isn't configured. This exists so
 * CourtSyncService and its routes/tests work end-to-end against a real
 * adapter shape before a vendor is chosen — staff use the manual-override
 * endpoint to record a case's state by hand in the meantime, exactly the
 * fallback the roadmap calls for ("staff can correct a case's synced
 * state by hand when the feed is wrong or stale").
 *
 * A real provider (e.g. providers/kleopatraProvider.js) would live next to
 * this file and implement the same one method, calling out to the
 * licensed API's case-status endpoint; see ../providerSelector.js for how
 * one gets selected.
 */

module.exports = {
  name: 'manual',

  async fetchCaseStatus() {
    const err = new Error(
      'No court-data vendor is configured (COURT_SYNC_PROVIDER=manual). ' +
      'Set COURT_SYNC_PROVIDER once a licensed provider is added, or use the manual-override endpoint to record this case\'s state by hand.'
    );
    err.code = 'COURT_SYNC_NOT_CONFIGURED';
    throw err;
  }
};
