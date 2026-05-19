const { Resend } = require('resend');
const axios = require('axios');

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── Email via Resend ─────────────────────────────────────────────────────────
async function sendEmailReminder({ tenant_name, address, city, state, end_date, days_left, yearly_rent, owner_email }) {
  const isExpired = days_left < 0;
  const subject = isExpired
    ? `⚠️ Rent expired: ${address}, ${city}`
    : `🔔 Rent expiring in ${days_left} days: ${address}, ${city}`;

  const urgencyColor = isExpired ? '#A32D2D' : days_left <= 30 ? '#854F0B' : '#3B6D11';
  const statusText = isExpired
    ? `<strong style="color:#A32D2D">Rent expired ${Math.abs(days_left)} day${Math.abs(days_left) !== 1 ? 's' : ''} ago</strong>`
    : `Rent expires in <strong style="color:${urgencyColor}">${days_left} day${days_left !== 1 ? 's' : ''}</strong>`;

  const html = `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #eee;border-radius:8px">
    <h2 style="margin:0 0 4px;font-size:18px;color:#111">Rent Tracker Reminder</h2>
    <p style="margin:0 0 20px;font-size:13px;color:#666">Automated alert from your property tracker</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0">Tenant</td><td style="padding:8px 0;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0">${tenant_name}</td></tr>
      <tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0">Property</td><td style="padding:8px 0;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0">${address}, ${city}, ${state}</td></tr>
      <tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0">Yearly Rent</td><td style="padding:8px 0;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0">₦${Number(yearly_rent).toLocaleString('en-NG')}</td></tr>
      <tr><td style="padding:8px 0;color:#666;border-bottom:1px solid #f0f0f0">Expiry Date</td><td style="padding:8px 0;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0">${new Date(end_date).toLocaleDateString('en-NG',{day:'numeric',month:'long',year:'numeric'})}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Status</td><td style="padding:8px 0;text-align:right">${statusText}</td></tr>
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#999">Log in to your Rent Tracker to renew the lease or record a payment.</p>
  </div>`;

  try {
    await resend.emails.send({
      from: process.env.REMINDER_FROM_EMAIL,
      to: owner_email || process.env.REMINDER_TO_EMAIL,
      subject,
      html,
    });
    console.log(`[Email] Sent reminder for ${address}`);
    return true;
  } catch (err) {
    console.error('[Email] Failed:', err.message);
    return false;
  }
}

// ─── SMS via Termii ───────────────────────────────────────────────────────────
async function sendSmsReminder({ tenant_name, address, city, end_date, days_left, phone }) {
  const isExpired = days_left < 0;
  const statusMsg = isExpired
    ? `EXPIRED ${Math.abs(days_left)}d ago`
    : `expires in ${days_left}d`;

  const message = `[Rent Tracker] ${tenant_name} at ${address}, ${city}: rent ${statusMsg} (${new Date(end_date).toLocaleDateString('en-NG')}). Log in to renew.`;

  const to = phone || process.env.REMINDER_PHONE;
  if (!to) { console.warn('[SMS] No phone number configured.'); return false; }

  try {
    await axios.post('https://api.ng.termii.com/api/sms/send', {
      to,
      from: process.env.TERMII_SENDER_ID || 'RentTrack',
      sms: message,
      type: 'plain',
      channel: 'generic',
      api_key: process.env.TERMII_API_KEY,
    });
    console.log(`[SMS] Sent reminder for ${address} → ${to}`);
    return true;
  } catch (err) {
    console.error('[SMS] Failed:', err.response?.data || err.message);
    return false;
  }
}

module.exports = { sendEmailReminder, sendSmsReminder };
