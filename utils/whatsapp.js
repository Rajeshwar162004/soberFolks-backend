// utils/whatsapp.js — Twilio WhatsApp message sender
// WhatsApp failures are ALWAYS logged but never thrown — ride flow must not break.

const TWILIO_ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WA_FROM      = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';

/** Normalise any phone string to whatsapp:+91XXXXXXXXXX format */
function toWaNumber(phone) {
  let digits = String(phone || '').replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) {
    // Assume India (+91) for 10-digit numbers
    digits = digits.length === 10 ? `+91${digits}` : `+${digits}`;
  }
  return `whatsapp:${digits}`;
}

function fromNumber() {
  const n = TWILIO_WA_FROM.replace(/^whatsapp:/, '');
  return `whatsapp:${n}`;
}

/**
 * Send a single WhatsApp message via Twilio.
 * Returns { sid } on success, { error } on failure (never throws).
 */
async function sendWhatsAppMessage(to, body) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.warn('⚠️  WhatsApp: Twilio credentials not configured — message skipped.');
    return { skipped: true };
  }

  try {
    // Lazy-require so missing `twilio` package doesn't crash server startup
    const client = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const msg = await client.messages.create({
      from: fromNumber(),
      to:   toWaNumber(to),
      body,
    });
    console.log(`✅ WhatsApp sent to ${to} — sid: ${msg.sid}`);
    return { sid: msg.sid };
  } catch (err) {
    console.error(`❌ WhatsApp send failed to ${to}:`, err.message);
    return { error: err.message };
  }
}

/**
 * Send ride-accepted WhatsApp notification to all safety contacts.
 * @param {Array<{name,phone}>} contacts
 * @param {{ consumerName, driverName, driverPhone, vehicleNumber,
 *           pickup, drop, fare, etaMinutes }} details
 */
async function sendRideAcceptedNotification(contacts, details) {
  if (!Array.isArray(contacts) || contacts.length === 0) return;

  const { consumerName, driverName, driverPhone, vehicleNumber,
          pickup, drop, fare, etaMinutes } = details;

  const body =
    `🚗 *Ride Safety Alert — SoberFolk*\n\n` +
    `*${consumerName || 'Your contact'}* has booked a ride.\n\n` +
    `👤 *Driver:* ${driverName   || 'N/A'}\n` +
    `📞 *Driver Phone:* ${driverPhone  || 'N/A'}\n` +
    `🛵 *Vehicle:* ${vehicleNumber || 'N/A'}\n` +
    `📍 *Pickup:* ${pickup}\n` +
    `🏁 *Drop:* ${drop}\n` +
    `💰 *Fare:* ₹${fare}\n` +
    `⏱️ *ETA to pickup:* ~${etaMinutes || '?'} min\n\n` +
    `Stay safe! 🙏 — SoberFolk`;

  for (const c of contacts) {
    await sendWhatsAppMessage(c.phone, body);
  }
}

/**
 * Send live-tracking link WhatsApp message to all safety contacts.
 * @param {Array<{name,phone}>} contacts
 * @param {{ consumerName, driverName, pickup, drop, trackUrl }} details
 */
async function sendLiveTrackNotification(contacts, details) {
  if (!Array.isArray(contacts) || contacts.length === 0) return;

  const { consumerName, driverName, pickup, drop, trackUrl } = details;

  const body =
    `📍 *Live Ride Tracking — SoberFolk*\n\n` +
    `*${consumerName || 'Your contact'}*'s ride has started!\n\n` +
    `👤 *Driver:* ${driverName || 'N/A'}\n` +
    `📍 *From:* ${pickup}\n` +
    `🏁 *To:* ${drop}\n\n` +
    `🗺️ *Track live location:*\n${trackUrl}\n\n` +
    `_(Updates every 5 sec · Link expires when ride ends)_`;

  for (const c of contacts) {
    await sendWhatsAppMessage(c.phone, body);
  }
}

module.exports = { sendWhatsAppMessage, sendRideAcceptedNotification, sendLiveTrackNotification };
