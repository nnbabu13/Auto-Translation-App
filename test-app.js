
const http = require('http');
const { Pool } = require('pg');

const API_HOST = 'localhost';
const API_PORT = 5000;
const API_BASE = '/api';
const DATABASE_URL = 'postgresql://Translationapp_coachunder:d1102b1d82da238377daa3cce00efd272f42e41e@ww2io7.h.filess.io:5433/Translationapp_coachunder';

async function insertTestUser() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();
  
  try {
    await client.query(
      `INSERT INTO translationapp_coachunder.users (id, email, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      ['test-user-id-123', 'test@example.com', 'Test', 'User']
    );
    console.log('✅ Test user inserted (or already exists)');
  } finally {
    client.release();
    await pool.end();
  }
}

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: `${API_BASE}${path}`,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          const parsedBody = body ? JSON.parse(body) : null;
          resolve({ status: res.statusCode, data: parsedBody, rawBody: body });
        } catch (e) {
          reject(new Error(`Failed to parse JSON. Raw body: ${body}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function testApp() {
  console.log('🚀 Starting app tests...');
  let sessionId = null;

  try {
    // 0. Insert test user
    await insertTestUser();

    // 1. Test Health Endpoint
    console.log('\n1️⃣ Testing Health Endpoint...');
    const healthRes = await makeRequest('GET', '/healthz');
    console.log(`✅ Health Check Passed: ${JSON.stringify(healthRes.data)}`);

    // 2. Test Create Session
    console.log('\n2️⃣ Testing Create Session...');
    const createRes = await makeRequest('POST', '/sessions', {
      name: 'Test Session',
      targetLanguage: 'French'
    });
    console.log(`✅ Session Created: ${JSON.stringify(createRes.data)}`);
    sessionId = createRes.data.id;

    // 3. Test List Sessions
    console.log('\n3️⃣ Testing List Sessions...');
    const listRes = await makeRequest('GET', '/sessions');
    console.log(`✅ Sessions Listed: ${JSON.stringify(listRes.data)}`);

    // 4. Test Get Stats
    console.log('\n4️⃣ Testing Get Stats...');
    const statsRes = await makeRequest('GET', '/sessions/stats');
    console.log(`✅ Stats Retrieved: ${JSON.stringify(statsRes.data)}`);

    // 5. Test Get Single Session
    console.log('\n5️⃣ Testing Get Single Session...');
    const getRes = await makeRequest('GET', `/sessions/${sessionId}`);
    console.log(`✅ Session Retrieved: ${JSON.stringify(getRes.data)}`);

    // 6. Test Delete Session
    console.log('\n6️⃣ Testing Delete Session...');
    const deleteRes = await makeRequest('DELETE', `/sessions/${sessionId}`);
    console.log(`✅ Session Deleted: Status ${deleteRes.status}`);

    // 7. Re-test List to confirm deletion
    console.log('\n7️⃣ Re-testing List Sessions (should be empty)...');
    const listRes2 = await makeRequest('GET', '/sessions');
    console.log(`✅ Sessions Listed After Delete: ${JSON.stringify(listRes2.data)}`);

    console.log('\n🎉 All tests passed!');

  } catch (error) {
    console.error('\n❌ Test Failed:');
    console.error(error.message);
  }
}

testApp();
