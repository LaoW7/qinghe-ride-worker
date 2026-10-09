import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from './worker.mjs';


const env = { ACCESS_KEY: 'test-key-' + 'A'.repeat(40), SMK_TOKEN: 'test-only-smk-token', COUPON_ID: '9000000000000000001', USER_COUPON_ID: '9000000000000000002' };
const req = (key = env.ACCESS_KEY, extra = {}) => new Request('https://qinghe.example/api/ride', {
  method: 'POST', headers: { Authorization: 'Bearer ' + key, ...extra },
});

test('page is private-cache disabled, contains valid JS, and does not embed credentials', async () => {
  const response = await worker.fetch(new Request('https://qinghe.example/'), env);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const html = await response.text();
  assert.ok(!html.includes(env.SMK_TOKEN));
  assert.ok(!html.includes(env.ACCESS_KEY));
  const script = html.match(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/);
  assert.ok(response.headers.get('Content-Security-Policy').includes(script[1]));
  new vm.Script(script[2]);
});

test('authentication and cross-site requests stop before upstream calls', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('must not call upstream'); };
  try {
    assert.equal((await worker.fetch(req('incorrect'), env)).status, 401);
    assert.equal((await worker.fetch(req(env.ACCESS_KEY, { Origin: 'https://attacker.example' }), env)).status, 403);
    assert.equal((await worker.fetch(req(), { ACCESS_KEY: 'short' })).status, 503);
    assert.equal((await worker.fetch(req(), { ACCESS_KEY: env.ACCESS_KEY })).status, 503);
  } finally { globalThis.fetch = originalFetch; }
});

test('two conversions use correct payloads and safely encode the ride-page token', async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (url, options) => {
    count++;
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    if (count === 1) {
      assert.equal(url, 'https://open.iconntech.com/unifyUser/changeToken');
      assert.deepEqual(body, { appId: '413201297836154880', token: env.SMK_TOKEN });
      return Response.json({ data: 'channel-test-token' });
    }
    assert.equal(url, 'https://talent.hzrcm.cn/smk_hztalent/front/app/home/getHzrckToken');
    assert.deepEqual(body, { channelToken: 'channel-test-token', channel: 'smk_app' });
    assert.equal(options.headers.sendClient, 'hellohzsmk');
    return Response.json({ code: 'PY0000', response: { hzrckToken: 'talent+/&token' } });
  };
  try {
    const response = await worker.fetch(req(), env);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(count, 2);
    const destination = new URL(data.url);
    assert.equal(destination.origin, 'https://talent.hzrcm.cn');
    assert.ok(destination.hash.startsWith('#/byBus?'));
    const params = new URLSearchParams(destination.hash.split('?')[1]);
    assert.equal(params.get('accessToken'), 'talent+/&token');
    assert.equal(params.get('qid'), env.COUPON_ID);
    assert.equal(params.get('userCouponId'), env.USER_COUPON_ID);
    assert.ok(!JSON.stringify(data).includes(env.SMK_TOKEN));
  } finally { globalThis.fetch = originalFetch; }
});

test('direct talent-token mode works without a SMK login credential', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('direct mode must not call upstream'); };
  try {
    for (const smk of [undefined, '', '   ']) {
      const directEnv = { ...env, SMK_TOKEN: smk, HZRCK_TOKEN: ' direct+/&token ' };
      assert.equal((await worker.fetch(req('incorrect'), directEnv)).status, 401);
      const response = await worker.fetch(req(), directEnv);
      assert.equal(response.status, 200);
      const result = await response.json();
      const destination = new URL(result.url);
      const params = new URLSearchParams(destination.hash.split('?')[1]);
      assert.equal(destination.origin, 'https://talent.hzrcm.cn');
      assert.equal(params.get('accessToken'), 'direct+/&token');
      assert.equal(params.get('qid'), env.COUPON_ID);
      assert.equal(params.get('userCouponId'), env.USER_COUPON_ID);
      const html = await (await worker.fetch(new Request('https://qinghe.example/'), directEnv)).text();
      assert.ok(!html.includes('direct+/&token'));
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('SMK conversion takes priority over an expired fixed talent token and exchanges on each invocation', async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async (url) => {
    count++;
    return url.endsWith('/changeToken')
      ? Response.json({ data: 'channel-test-token' })
      : Response.json({ code: 'PY0000', response: { hzrckToken: 'new-talent-token-' + count } });
  };
  try {
    const both = { ...env, HZRCK_TOKEN: 'expired-talent-token' };
    for (const expected of ['new-talent-token-2', 'new-talent-token-4']) {
      const response = await worker.fetch(req(), both);
      assert.equal(response.status, 200);
      const result = await response.json();
      const params = new URLSearchParams(new URL(result.url).hash.split('?')[1]);
      assert.equal(params.get('accessToken'), expected);
    }
    assert.equal(count, 4);
  } finally { globalThis.fetch = originalFetch; }
});

test('failed SMK conversion reports recovery guidance without falling back to the fixed talent token', async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => { count++; return Response.json({ data: null }); };
  try {
    const response = await worker.fetch(req(), { ...env, HZRCK_TOKEN: 'expired-talent-token' });
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.ok(result.error.includes('更新 SMK_TOKEN'));
    assert.equal(result.url, undefined);
    assert.ok(!JSON.stringify(result).includes('expired-talent-token'));
    assert.ok(!JSON.stringify(result).includes(env.SMK_TOKEN));
    assert.equal(count, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('missing or unsafe numeric coupon IDs fail before any upstream call', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('must not call upstream'); };
  try {
    for (const patch of [
      { COUPON_ID: undefined },
      { USER_COUPON_ID: 9000000000000000002 },
      { COUPON_ID: '9000000000000000001&evil=true' },
      { USER_COUPON_ID: '' },
    ]) {
      const response = await worker.fetch(req(), { ...env, ...patch });
      assert.equal(response.status, 503);
      assert.ok((await response.text()).includes('COUPON_ID'));
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('upstream HTML, malformed tokens, and raw exceptions do not disclose secrets', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const mocked of [
      () => new Response('<html>challenge</html>'),
      () => Response.json({ data: { error: env.SMK_TOKEN } }),
      () => { throw new Error(env.SMK_TOKEN); },
      () => new Response(env.SMK_TOKEN, { status: 403 }),
    ]) {
      globalThis.fetch = async () => mocked();
      const response = await worker.fetch(req(), env);
      assert.equal(response.status, 502);
      const output = await response.text();
      assert.ok(!output.includes(env.SMK_TOKEN));
      assert.ok(!output.includes('<html>'));
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('talent token errors are handled without treating error content as a ride link', async () => {
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => ++count === 1
    ? Response.json({ data: 'channel-test-token' })
    : Response.json({ code: 'PY0001', response: { hzrckToken: env.SMK_TOKEN } });
  try {
    const response = await worker.fetch(req(), env);
    assert.equal(response.status, 502);
    const output = await response.text();
    assert.ok(output.includes('PY0001'));
    assert.ok(!output.includes(env.SMK_TOKEN));
    assert.ok(!output.includes('https://hzrck'));
  } finally { globalThis.fetch = originalFetch; }
});

test('unknown routes and API GET requests cannot generate a ride link', async () => {
  assert.equal((await worker.fetch(new Request('https://qinghe.example/api/ride'), env)).status, 405);
  assert.equal((await worker.fetch(new Request('https://qinghe.example/unknown'), env)).status, 404);
});
