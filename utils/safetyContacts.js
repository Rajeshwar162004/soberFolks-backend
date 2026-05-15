// utils/safetyContacts.js — DB helpers for ride safety contacts

const db = require('../db');

async function ensureSafetyContactsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ride_safety_contacts (
      id         SERIAL PRIMARY KEY,
      ride_id    INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
      name       TEXT,
      phone      TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_safety_contacts_ride_id ON ride_safety_contacts(ride_id)`
  );
}

async function saveRideSafetyContacts(rideId, contacts) {
  await ensureSafetyContactsTable();

  console.log(`💾 [SafetyContacts] saveRideSafetyContacts — rideId: ${rideId}, count: ${contacts?.length ?? 0}`);

  if (!Array.isArray(contacts) || contacts.length === 0) {
    console.log('   No contacts to save.');
    return;
  }

  for (const c of contacts) {
    const phone = String(c.phone || '').replace(/[^\d+]/g, '');
    if (!phone || phone.length < 7) {
      console.log(`   Skipping invalid phone: "${c.phone}"`);
      continue;
    }
    await db.query(
      `INSERT INTO ride_safety_contacts (ride_id, name, phone) VALUES ($1, $2, $3)`,
      [rideId, c.name || null, phone]
    );
    console.log(`   ✅ Saved: ${c.name || '(no name)'} → ${phone}`);
  }
}

async function getRideSafetyContacts(rideId) {
  await ensureSafetyContactsTable();
  const result = await db.query(
    `SELECT name, phone FROM ride_safety_contacts WHERE ride_id = $1`,
    [rideId]
  );
  console.log(`📋 [SafetyContacts] getRideSafetyContacts — rideId: ${rideId}, found: ${result.rows.length} contacts`);
  if (result.rows.length > 0) {
    result.rows.forEach(r => console.log(`   → ${r.name || '(unnamed)'}: ${r.phone}`));
  }
  return result.rows;
}

module.exports = { saveRideSafetyContacts, getRideSafetyContacts, ensureSafetyContactsTable };
