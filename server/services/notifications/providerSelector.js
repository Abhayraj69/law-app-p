const logProvider = require('./providers/logProvider');

/**
 * Picks the notification backend a send goes through, the same
 * pluggable-provider shape server/services/esignature/providerSelector.js
 * and server/services/courtSync/providerSelector.js already use: a
 * provider is a small object exposing `send({ channel, to, subject, body })`,
 * and NotificationService never knows which one it's talking to. Only
 * 'log' exists today (see providers/logProvider.js) — set
 * NOTIFICATION_PROVIDER once a real vendor module (e.g.
 * providers/sendgridProvider.js) is added here to swap it in without
 * touching NotificationService itself.
 */
const PROVIDERS = { log: logProvider };

function getNotificationProvider() {
  const name = (process.env.NOTIFICATION_PROVIDER || 'log').toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown NOTIFICATION_PROVIDER "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

module.exports = { getNotificationProvider };
