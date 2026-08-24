const { run, get } = require('../src/db');
const { checkAndReleaseExpiredHolds } = require('../src/services/ttlScheduler');

async function testTTL() {
  console.log('--- STARTING TTL AUTO-RELEASE TEST ---');

  // 1. Create a dummy hold for seat 2 that expired 1 minute ago
  const pastDate = new Date(Date.now() - 60000).toISOString();
  await run(`UPDATE seats SET status = 'held' WHERE id = 2`);
  const holdRes = await run(
    `INSERT INTO holds (show_id, seat_id, user_id, hold_token, expires_at, status) VALUES (1, 2, 3, 'TEST-TTL-TOKEN', ?, 'active')`,
    [pastDate]
  );

  console.log(`Created test hold ID ${holdRes.lastID} for seat 2 with expired timestamp: ${pastDate}`);

  // Check initial state
  const initialSeat = await get(`SELECT status FROM seats WHERE id = 2`);
  console.log(`Initial seat status: ${initialSeat.status} (Expected: held)`);

  // 2. Trigger TTL auto-release check
  console.log('Running checkAndReleaseExpiredHolds()...');
  await checkAndReleaseExpiredHolds();

  // 3. Verify seat status reverted to 'available'
  const updatedSeat = await get(`SELECT status FROM seats WHERE id = 2`);
  const updatedHold = await get(`SELECT status FROM holds WHERE id = ?`, [holdRes.lastID]);

  console.log(`Updated seat status: ${updatedSeat.status} (Expected: available)`);
  console.log(`Updated hold status: ${updatedHold.status} (Expected: released)`);

  if (updatedSeat.status === 'available' && updatedHold.status === 'released') {
    console.log('✅ PASSED: TTL auto-release mechanism working perfectly!');
  } else {
    console.error('❌ FAILED: Seat was not released after TTL expiration.');
  }

  process.exit(0);
}

testTTL().catch((err) => {
  console.error(err);
  process.exit(1);
});
