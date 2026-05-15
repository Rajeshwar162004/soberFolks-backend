// utils/whatsapp.js — Twilio WhatsApp sender with full diagnostic logging
// WhatsApp failures are ALWAYS logged but never thrown — ride flow must not break.

const TWILIO_ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WA_FROM      = process.env.TWILIO_WHATSAPP_FROM || '+14155238886';

// Log credentials status on module load (masked)
console.log('📱 WhatsApp module loaded:');
console.log(`   SID:   ${TWILIO_ACCOUNT_SID ? TWILIO_ACCOUNT_SID.slice(0,8) + '...' : '❌ NOT SET'}`);
console.log(`   TOKEN: ${TWILIO_AUTH_TOKEN  ? '✅ SET (masked)' : '❌ NOT SET'}`);
console.log(`   FROM:  ${TWILIO_WA_FROM}`);

/** Normalise any phone string to whatsapp:+91XXXXXXXXXX format */
function toWaNumber(phone) {
  let digits = String(phone || '').replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) {
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
async function sendWhatsAppMessage(to, contentVariables) {
  const toFormatted = toWaNumber(to);
  const fromFormatted = fromNumber();

  console.log(`\n📤 [WhatsApp] Attempting send (Template):`);
  console.log(`   To:   ${toFormatted}`);
  console.log(`   Vars:`, contentVariables);

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.error('❌ [WhatsApp] SKIPPED — Twilio credentials not set in environment variables!');
    return { skipped: true };
  }

  try {
    const client = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    // Using the user's pre-approved Content API template
    const msg = await client.messages.create({
      from: fromFormatted,
      to:   toFormatted,
      contentSid: 'HXb5b62575e6e4ff6129ad7c8efe1f983e',
      contentVariables: JSON.stringify(contentVariables)
    });

    console.log(`✅ [WhatsApp] Message sent successfully!`);
    console.log(`   SID:    ${msg.sid}`);
    console.log(`   Status: ${msg.status}`);
    return { sid: msg.sid, status: msg.status };

  } catch (err) {
    console.error(`❌ [WhatsApp] Send FAILED to ${toFormatted}`);
    console.error(`   Error code:    ${err.code}`);
    console.error(`   Error message: ${err.message}`);
    return { error: err.message, code: err.code };
  }
}

/**
 * Send ride-accepted WhatsApp notification to all safety contacts.
 */
async function sendRideAcceptedNotification(contacts, details) {
  console.log(`\n🚗 [WhatsApp] sendRideAcceptedNotification called — ${contacts?.length ?? 0} contacts`);

  if (!Array.isArray(contacts) || contacts.length === 0) {
    console.log('   Skipped — no contacts provided.');
    return;
  }

  const { consumerName, driverName, driverPhone, vehicleNumber,
          pickup, drop, fare, etaMinutes } = details;

  console.log(`   Consumer: ${consumerName}, Driver: ${driverName}, ETA: ${etaMinutes} min`);

  const variables = {
    "1": consumerName || 'Your contact',
    "2": `Ride accepted! Driver: ${driverName || 'N/A'}, Vehicle: ${vehicleNumber || 'N/A'}. ETA: ${etaMinutes || '?'} min. \nFrom: ${pickup}\nTo: ${drop}`
  };

  for (const c of contacts) {
    console.log(`   → Sending to: ${c.phone} (${c.name || 'unnamed'})`);
    await sendWhatsAppMessage(c.phone, variables);
  }
}

/**
 * Send live-tracking link WhatsApp message to all safety contacts.
 */
async function sendLiveTrackNotification(contacts, details) {
  console.log(`\n📍 [WhatsApp] sendLiveTrackNotification called — ${contacts?.length ?? 0} contacts`);

  if (!Array.isArray(contacts) || contacts.length === 0) {
    console.log('   Skipped — no contacts provided.');
    return;
  }

  const { consumerName, driverName, pickup, drop, trackUrl } = details;

  console.log(`   Consumer: ${consumerName}, Track URL: ${trackUrl}`);

  const variables = {
    "1": consumerName || 'Your contact',
    "2": `Ride started! Driver: ${driverName || 'N/A'}\nTrack live location: ${trackUrl}`
  };

  for (const c of contacts) {
    console.log(`   → Sending to: ${c.phone} (${c.name || 'unnamed'})`);
    await sendWhatsAppMessage(c.phone, variables);
  }
}

module.exports = { sendWhatsAppMessage, sendRideAcceptedNotification, sendLiveTrackNotification };
