// Standalone Cloudflare Worker. Credentials belong in Secrets, never in this file.
// Integration reference: https://github.com/CH3NGYZ/hzsmkByBus
const APP_ID = '413201297836154880';
// Current official page reads accessToken (or token), qid, userCouponId.
// It renders binary QR bytes and refreshes using getOffLineCode itself.
const RIDE_PAGE = 'https://talent.hzrcm.cn/exthtml/youngTalentCard/freeCoderide/';

function rideLink(token, env) {
  const params = new URLSearchParams({
    accessToken: token,
    qid: env.COUPON_ID.trim(),
    userCouponId: env.USER_COUPON_ID.trim(),
  });
  return { url: RIDE_PAGE + '#/byBus?' + params.toString() };
}

class PublicError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

function respond(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...extra,
  }});
}

function json(body, status = 200) {
  return respond(JSON.stringify(body), status, { 'Content-Type': 'application/json; charset=utf-8' });
}

async function validKey(actual, expected) {
  if (!actual || actual.length > 1024) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}

async function postUpstream(url, body, headers, stage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new PublicError(stage + '失败，HTTP ' + response.status + '。');
    try { return await response.json(); }
    catch { throw new PublicError(stage + '返回格式异常，可能遇到接口防护或接口变更。'); }
  } catch (error) {
    if (error instanceof PublicError) throw error;
    if (controller.signal.aborted) throw new PublicError(stage + '超时，请稍后重试。', 504);
    // Never return raw exceptions or upstream bodies: they may contain credentials.
    throw new PublicError(stage + '连接失败，请检查上游可达性。');
  } finally { clearTimeout(timer); }
}

async function ride(env) {
  // The accessToken in getOffLineCode is a talent-system credential.
  // Direct mode avoids the SMK login-token conversion endpoints entirely.
  if (typeof env.HZRCK_TOKEN === 'string' && env.HZRCK_TOKEN.trim()) {
    return rideLink(env.HZRCK_TOKEN.trim(), env);
  }
  const changed = await postUpstream(
    'https://open.iconntech.com/unifyUser/changeToken',
    { appId: APP_ID, token: env.SMK_TOKEN.trim() },
    {
      Origin: 'https://talent.hzrcm.cn',
      'X-Requested-With': 'com.smk',
      Referer: 'https://talent.hzrcm.cn/',
    },
    '市民卡 Token 转换',
  );
  const channelToken = changed?.data;
  if (typeof channelToken !== 'string' || !channelToken.trim()) {
    throw new PublicError('未取得渠道 Token，请确认 SMK_TOKEN 是有效的市民卡 accessToken。');
  }
  const result = await postUpstream(
    'https://talent.hzrcm.cn/smk_hztalent/front/app/home/getHzrckToken',
    { channelToken, channel: 'smk_app' },
    {
      'Content-Type': 'application/json;charset=UTF-8',
      sendClient: 'hellohzsmk',
      sendChl: 'hzsmk.h5',
      Origin: 'https://talent.hzrcm.cn',
      'X-Requested-With': 'com.smk',
      Referer: 'https://talent.hzrcm.cn/exthtml/hangZhouTalentCard/index.html',
    },
    '人才系统 Token 转换',
  );
  const token = result?.response?.hzrckToken;
  if (result?.code !== 'PY0000' || typeof token !== 'string' || !token.trim()) {
    const code = typeof result?.code === 'string' && /^[A-Z0-9_]{1,24}$/.test(result.code)
      ? '，业务码 ' + result.code : '';
    throw new PublicError('未取得人才系统 Token' + code + '。请检查账号认定状态及 Token 有效性。');
  }
  return rideLink(token, env);
}

function page(nonce) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer"><title>青荷乘车码</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f3f6f2;color:#183329;font:17px/1.6 system-ui,-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:min(100%,430px);padding:30px;border-radius:24px;background:#fff;box-shadow:0 12px 45px #17392a12}h1{font-size:28px;margin:0 0 8px}p{color:#5b6f65;margin:0 0 24px}
label{display:block;margin:16px 0 6px}input[type=password]{width:100%;font:inherit;padding:12px;border:1px solid #cad6ce;border-radius:10px}button{font:inherit;cursor:pointer;border:0;border-radius:12px;padding:13px 16px;background:#186a46;color:white;width:100%;margin-top:18px}button:disabled{opacity:.6}#forget{background:transparent;color:#5b6f65;font-size:14px;margin-top:4px}#status{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:20px;color:#415c4d}.remember{font-size:14px;display:flex;gap:8px;align-items:center}.note{font-size:13px;margin:16px 0 0}
</style></head><body><main><h1>青荷乘车码</h1><p>打开你的公交、地铁免费乘车码。</p>
<form id="form"><label for="key">个人访问码</label><input id="key" type="password" autocomplete="current-password" required maxlength="1024">
<label class="remember"><input id="remember" type="checkbox" checked>在这台设备上记住，下次自动打开</label>
<button id="go" type="submit">打开乘车码</button></form><button id="forget" type="button">清除本机访问码</button>
<div id="status" role="status" aria-live="polite"></div><p class="note">首次配置后，请在实际进站前确认二维码能够正常显示和刷新。</p></main>
<script nonce="${nonce}">
const storageName='qinghe.accessKey.v1';
const keyInput=document.getElementById('key'), statusBox=document.getElementById('status'), goButton=document.getElementById('go');
let busy=false;
function readSaved(){try{return localStorage.getItem(storageName)||'';}catch{return '';}}
function forget(){try{localStorage.removeItem(storageName);}catch{}keyInput.value='';statusBox.textContent='已清除本机访问码。';}
async function openRide(){
  if(busy)return;
  const key=keyInput.value.trim();if(!key){statusBox.textContent='请输入个人访问码。';return;}
  busy=true;goButton.disabled=true;statusBox.textContent='正在准备乘车码…';
  try{
    const response=await fetch('/api/ride',{method:'POST',headers:{Authorization:'Bearer '+key},cache:'no-store'});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'请求失败，请重试。');
    const destination=new URL(result.url);
    if(!['https://hzrck.hzzhdj.cn','https://talent.hzrcm.cn'].includes(destination.origin)||destination.pathname!=='/exthtml/youngTalentCard/freeCoderide/')throw new Error('乘车码地址异常。');
    if(document.getElementById('remember').checked){try{localStorage.setItem(storageName,key);}catch{}}
    else{try{localStorage.removeItem(storageName);}catch{}}
    statusBox.textContent='即将打开乘车码…';location.replace(destination.href);
  }catch(error){statusBox.textContent=error.message;}
  finally{busy=false;goButton.disabled=false;}
}
document.getElementById('form').addEventListener('submit',event=>{event.preventDefault();openRide();});
document.getElementById('forget').addEventListener('click',forget);
keyInput.value=readSaved();if(keyInput.value)openRide();
</script></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') {
      const nonce = crypto.randomUUID();
      return respond(page(nonce), 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      });
    }
    if (url.pathname !== '/api/ride') return respond('Not found', 404);
    if (request.method !== 'POST') return respond('Method not allowed', 405, { Allow: 'POST' });
    if (typeof env.ACCESS_KEY !== 'string' || env.ACCESS_KEY.trim().length < 32) {
      return json({ error: '请先配置至少 32 位随机字符的 ACCESS_KEY Secret。' }, 503);
    }
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: '不允许来自其他网站的请求。' }, 403);
    const key = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!await validKey(key, env.ACCESS_KEY.trim())) return json({ error: '个人访问码错误。' }, 401);
    const hasSmkToken = typeof env.SMK_TOKEN === 'string' && env.SMK_TOKEN.trim();
    const hasTalentToken = typeof env.HZRCK_TOKEN === 'string' && env.HZRCK_TOKEN.trim();
    if (!hasSmkToken && !hasTalentToken) {
      return json({ error: '请配置 HZRCK_TOKEN Secret，填入人才系统 Token；或配置 SMK_TOKEN，填入市民卡登录 Token。' }, 503);
    }
    if (typeof env.COUPON_ID !== 'string' || !/^\d{1,32}$/.test(env.COUPON_ID.trim()) ||
        typeof env.USER_COUPON_ID !== 'string' || !/^\d{1,32}$/.test(env.USER_COUPON_ID.trim())) {
      return json({ error: '请配置 COUPON_ID 和 USER_COUPON_ID，分别填写抓包里的 couponId 与 userCouponId 字符串。' }, 503);
    }
    try { return json(await ride(env)); }
    catch (error) {
      return json({ error: error instanceof PublicError ? error.message : '服务暂时不可用。' },
        error instanceof PublicError ? error.status : 500);
    }
  },
};
