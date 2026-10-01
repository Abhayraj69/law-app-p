/**
 * Log notification provider — the only provider this app ships today. No
 * email/SMS/WhatsApp Business vendor contract exists yet (see
 * 0031_notifications.sql's header), so `send` never actually delivers
 * anything: it just reports back `delivered: false` so
 * NotificationService records the attempt as 'logged' rather than 'sent',
 * an honest reflection of what happened — not a forged delivery receipt
 * for a message that was never really sent, the same posture
 * server/services/inviteService.js already documents for invite emails.
 *
 * A real provider (e.g. providers/sendgridProvider.js, twilioProvider.js,
 * whatsappBusinessProvider.js) would live next to this file and implement
 * the same one method per channel, calling out to that vendor's API; see
 * ../providerSelector.js for how one gets selected.
 */

module.exports = {
  name: 'log',

  async send({ channel, to, subject, body }, log) {
    if (log) {
      log.info('notification logged (no vendor configured)', { context: 'NOTIFICATIONS', channel, to });
    }
    return { delivered: false, note: 'No notification vendor is configured — recorded, not delivered.' };
  }
};
