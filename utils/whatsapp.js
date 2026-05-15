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
async function sendWhatsAppMessage(to, body) {
  const toFormatted = toWaNumber(to);
  const fromFormatted = fromNumber();

  console.log(`\n📤 [WhatsApp] Attempting send:`);
  console.log(`   To:   ${toFormatted}`);
  console.log(`   From: ${fromFormatted}`);
  console.log(`   Body: ${body.slice(0, 60)}...`);

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.error('❌ [WhatsApp] SKIPPED — Twilio credentials not set in environment variables!');
    console.error('   Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to Render environment.');
    return { skipped: true };
  }

  try {
    const client = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    const msg = await client.messages.create({
      from: fromFormatted,
      to:   toFormatted,
      body,
    });

    console.log(`✅ [WhatsApp] Message sent successfully!`);
    console.log(`   SID:    ${msg.sid}`);
    console.log(`   Status: ${msg.status}`);
    console.log(`   To:     ${msg.to}`);
    return { sid: msg.sid, status: msg.status };

  } catch (err) {
    console.error(`❌ [WhatsApp] Send FAILED to ${toFormatted}`);
    console.error(`   Error code:    ${err.code}`);
    console.error(`   Error message: ${err.message}`);
    console.error(`   More info:     ${err.moreInfo || 'N/A'}`);
    // Common Twilio error codes:
    // 63016 — Channel not found (recipient not opted into sandbox)
    // 63007 — Twilio number has no capabilities for this channel
    // 21211 — Invalid 'To' number
    // 20003 — Authentication failure (bad SID/Token)
    if (err.code === 63016) {
      console.error(`   👆 SANDBOX: Recipient ${toFormatted} must first text "join <keyword>" to ${fromFormatted}`);
    } else if (err.code === 20003) {
      console.error(`   👆 AUTH FAILED: Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Render env`);
    }
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
    console.log(`   → Sending to: ${c.phone} (${c.name || 'unnamed'})`);
    await sendWhatsAppMessage(c.phone, body);
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

  const body =
    `📍 *Live Ride Tracking — SoberFolk*\n\n` +
    `*${consumerName || 'Your contact'}*'s ride has started!\n\n` +
    `👤 *Driver:* ${driverName || 'N/A'}\n` +
    `📍 *From:* ${pickup}\n` +
    `🏁 *To:* ${drop}\n\n` +
    `🗺️ *Track live location:*\n${trackUrl}\n\n` +
    `_(Updates every 5 sec · Link expires when ride ends)_`;

  for (const c of contacts) {
    console.log(`   → Sending to: ${c.phone} (${c.name || 'unnamed'})`);
    await sendWhatsAppMessage(c.phone, body);
  }
}

module.exports = { sendWhatsAppMessage, sendRideAcceptedNotification, sendLiveTrackNotification };
