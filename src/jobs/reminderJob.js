const cron = require('node-cron');
const { query } = require('../db/pool');
const { sendEmailReminder, sendSmsReminder } = require('../utils/notifications');

// Reminder thresholds in days
const REMIND_AT_DAYS = [60, 30, 14, 7, 0];

async function runReminderJob() {
  console.log(`[Cron] Running reminder check — ${new Date().toISOString()}`);
  try {
    // Fetch all active leases expiring within 61 days OR already expired (up to 30 days past)
    const result = await query(`
      SELECT
        l.id AS lease_id,
        l.end_date,
        l.yearly_rent,
        l.duration_months,
        (l.end_date::date - CURRENT_DATE) AS days_left,
        p.address, p.city, p.state, p.country,
        t.name AS tenant_name, t.phone AS tenant_phone,
        u.email AS owner_email, u.phone AS owner_phone,
        u.name  AS owner_name
      FROM leases l
      JOIN properties p ON p.id = l.property_id
      JOIN tenants    t ON t.id = l.tenant_id
      JOIN users      u ON u.id = p.user_id
      WHERE l.status = 'active'
        AND (l.end_date::date - CURRENT_DATE) BETWEEN -30 AND 61
      ORDER BY l.end_date ASC
    `);

    console.log(`[Cron] Found ${result.rows.length} lease(s) needing attention.`);

    for (const lease of result.rows) {
      const days = parseInt(lease.days_left);

      // Only send at specific thresholds to avoid spam
      const shouldSend = REMIND_AT_DAYS.includes(days) || days < 0;
      if (!shouldSend) continue;

      // Check if reminder already sent for this threshold today
      const alreadySent = await query(`
        SELECT id FROM reminder_logs
        WHERE lease_id = $1 AND days_before = $2
          AND sent_at::date = CURRENT_DATE
      `, [lease.lease_id, days]);

      if (alreadySent.rows.length) {
        console.log(`[Cron] Skipping lease ${lease.lease_id} — already reminded at ${days}d today.`);
        continue;
      }

      const payload = {
        tenant_name: lease.tenant_name,
        address: lease.address,
        city: lease.city,
        state: lease.state,
        end_date: lease.end_date,
        days_left: days,
        yearly_rent: lease.yearly_rent,
        owner_email: lease.owner_email,
        phone: lease.owner_phone,
      };

      // Send email
      const emailSent = await sendEmailReminder(payload);
      if (emailSent) {
        await query(
          'INSERT INTO reminder_logs (lease_id, channel, days_before) VALUES ($1,$2,$3)',
          [lease.lease_id, 'email', days]
        );
      }

      // Send SMS if owner has a phone
      if (lease.owner_phone || process.env.REMINDER_PHONE) {
        const smsSent = await sendSmsReminder(payload);
        if (smsSent) {
          await query(
            'INSERT INTO reminder_logs (lease_id, channel, days_before) VALUES ($1,$2,$3)',
            [lease.lease_id, 'sms', days]
          );
        }
      }
    }
    console.log('[Cron] Reminder job complete.');
  } catch (err) {
    console.error('[Cron] Error:', err.message);
  }
}

function startReminderJob() {
  // Run every day at 8:00 AM server time
  cron.schedule('0 8 * * *', runReminderJob, {
    timezone: 'Africa/Lagos',
  });
  console.log('[Cron] Reminder job scheduled — daily at 08:00 WAT (Africa/Lagos)');

  // Also run once on startup in production to catch anything missed
  if (process.env.NODE_ENV === 'production') {
    setTimeout(runReminderJob, 5000);
  }
}

module.exports = { startReminderJob, runReminderJob };
