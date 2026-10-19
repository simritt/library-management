process.env.NODE_ENV = 'test'; // never run API tests against the development database
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/server');
const http = require('http');

let server;
let baseUrl;

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (options.body) {
      reqOptions.headers['Content-Type'] = 'application/json';
    }

    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

test('API End-to-End Tests for Core Modules', async (t) => {
  // Start server on ephemeral port for tests
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  t.after(async () => {
    server.close();
    const { pool } = require('../src/config/db');
    await pool.end();
  });

  await t.test('Health check endpoint returns healthy status', async () => {
    const res = await makeRequest('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'healthy');
  });

  await t.test('Public Catalog Search allows anonymous browsing (SE-2, FR-Search)', async () => {
    const res = await makeRequest('/api/catalog/books?q=Clean Code');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(Array.isArray(res.data.data));
    assert.ok(res.data.data.length > 0);
    assert.strictEqual(res.data.data[0].isbn, '9780132350884');
  });

  await t.test('Protected routes reject unauthorized requests without session cookie (SE-4)', async () => {
    const res = await makeRequest('/api/circulation/loans');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.data.success, false);
  });

  let staffCookie = '';

  await t.test('Staff login generates secure session cookie for valid credentials', async () => {
    const res = await makeRequest('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'Admin@123' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.strictEqual(res.data.user.role, 'Administrator');
    
    // Extract set-cookie
    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie);
    staffCookie = Array.isArray(setCookie) ? setCookie[0].split(';')[0] : setCookie.split(';')[0];
  });

  await t.test('Authenticated Admin can view active circulation loans', async () => {
    const res = await makeRequest('/api/circulation/loans', {
      headers: { Cookie: staffCookie }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(Array.isArray(res.data.loans));
  });

  await t.test('Duplicate ISBN addition is rejected (FR-Catalog.Add-03)', async () => {
    const res = await makeRequest('/api/catalog/books', {
      method: 'POST',
      headers: { Cookie: staffCookie },
      body: {
        isbn: '9780132350884', // Existing clean code ISBN
        title: 'Clean Code Duplicate Attempt',
        author: 'Robert C. Martin',
        category: 'Software Engineering',
        publisher: 'Prentice Hall',
        edition: '1st Edition',
        copiesCount: 1
      }
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.data.isDuplicate, true);
  });

  await t.test('Invalid ISBN checksum is rejected (FR-Catalog.Add-02)', async () => {
    const res = await makeRequest('/api/catalog/books', {
      method: 'POST',
      headers: { Cookie: staffCookie },
      body: {
        isbn: '9780132350880', // Corrupted checksum digit
        title: 'Invalid ISBN Book',
        author: 'Test Author',
        category: 'Test Category',
        publisher: 'Test Pub',
        edition: '1st Edition',
        copiesCount: 1
      }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
  });

  await t.test('Member registration enforces institutional ID uniqueness (FR-Member.Register-02)', async () => {
    const res = await makeRequest('/api/members/register', {
      method: 'POST',
      headers: { Cookie: staffCookie },
      body: {
        name: 'Duplicate Student Test',
        institutionalId: '2024300274', // Parth Zala's existing Roll No
        department: 'Computer Engineering',
        email: 'unique_new_email@spit.ac.in',
        phone: '9999999999',
        memberType: 'Student'
      }
    });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.data.success, false);
  });

  await t.test('Deactivation is blocked if member has active loans (FR-Member.Deactivate-02)', async () => {
    const res = await makeRequest('/api/members/MEM-2026-0001/deactivate', {
      method: 'POST',
      headers: { Cookie: staffCookie }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.success, false);
    assert.ok(res.data.blockingReason);
  });
});
