/**
 * Local e-signature provider — the only provider this app actually calls
 * today. There is no third-party account to sign up for and nothing to
 * configure: a signature request's "delivery" is a one-time link on this
 * app's own public page (/sign-document.html?token=...), the same shape as
 * the admin-invite flow's link (see server/services/inviteService.js). The
 * signer completes the request themselves by typing their name — recorded
 * as real signer metadata (typed name, IP, timestamp) on the
 * signature_requests row, never a forged rendering of a stamped document.
 *
 * A real provider (DocuSignProvider, HelloSignProvider) would live next to
 * this file and implement the same two methods, calling out to that
 * service's API in `send` and its cancel endpoint in `void`; see
 * ../providerSelector.js for how one gets selected.
 */

module.exports = {
  name: 'local',

  // There's nothing to actually send anywhere — the request already exists
  // in our own database the moment it's created, and the signer reaches it
  // by following the link they were given. No external_reference to record.
  async send() {
    return { externalReference: null };
  },

  // Nothing to cancel on a remote system either.
  async void() {
    return {};
  }
};
