const http = require('http');

async function testConcurrency() {
  console.log('--- STARTING CONCURRENCY PROTECTION TEST ---');
  console.log('Simulating 10 simultaneous hold requests for the exact same seat (Seat ID 1)...');

  // 1. Get auth token
  const loginData = JSON.stringify({ email: 'john@example.com', password: 'password123' });
  const loginRes = await makeRequest('/api/auth/login', 'POST', loginData);
  const token = JSON.parse(loginRes.body).token;

  // 2. Launch 10 simultaneous hold requests for seat_ids: [1]
  const payload = JSON.stringify({ show_id: 1, seat_ids: [1] });

  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(makeRequest('/api/seats/hold', 'POST', payload, token));
  }

  const results = await Promise.all(promises);

  let successCount = 0;
  let conflictCount = 0;

  results.forEach((res, index) => {
    if (res.status === 200) {
      successCount++;
      console.log(`Request #${index + 1}: SUCCESS (Hold Granted)`);
    } else {
      conflictCount++;
      const json = JSON.parse(res.body);
      console.log(`Request #${index + 1}: REJECTED (${res.status}) -> ${json.error}`);
    }
  });

  console.log('--- TEST RESULTS ---');
  console.log(`Successful Holds: ${successCount} (Expected: 1)`);
  console.log(`Rejected Conflicts: ${conflictCount} (Expected: 9)`);

  if (successCount === 1 && conflictCount === 9) {
    console.log('✅ PASSED: Concurrency protection verified! Zero double-holds allowed.');
  } else {
    console.error('❌ FAILED: Concurrency violation detected!');
  }
}

function makeRequest(path, method, body, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

testConcurrency().catch(console.error);
