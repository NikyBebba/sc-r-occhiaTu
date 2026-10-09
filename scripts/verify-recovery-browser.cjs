#!/usr/bin/env node
// SDK pubblico v2 reale; server Auth e token generati solo per questo test locale.
// Uso: NODE_PATH=... node scripts/verify-recovery-browser.cjs --sdk=/tmp/supabase-v2.js
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const { createTestPassword } = require('./test-password.cjs');
const root = path.resolve(__dirname, '..');
const sdkPath = process.argv.find(arg => arg.startsWith('--sdk='))?.slice(6);
if (!sdkPath) throw new Error('Specificare --sdk con il percorso del SDK pubblico v2.');
const sdk = fs.readFileSync(sdkPath);
const password = createTestPassword() + String.fromCharCode(33,64);
const user = { id: randomUUID(), email: 'n@example.test', aud: 'authenticated', role: 'authenticated' };
const amrMethod = process.argv.find(arg => arg.startsWith('--amr='))?.slice(6) || 'otp';
const exp = Math.floor(Date.now()/1000) + 3600;
const jwt = [
  { alg: 'HS256', typ: 'JWT' },
  { sub: user.id, aud: 'authenticated', role: 'authenticated', exp, iat: exp-3600, amr: amrMethod === 'none' ? [] : [{method:amrMethod,timestamp:exp-3600}] }
].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.' + randomBytes(32).toString('base64url');
const recoveryHash = new URLSearchParams({ access_token: jwt, refresh_token: randomBytes(32).toString('hex'), expires_in: '3600', expires_at: String(exp), token_type: 'bearer', type: 'recovery' });
const resetRecipients = [];
let updates = 0, correctPassword = false, authDenied = false, checks = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, x-client-info, content-type, x-supabase-api-version');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (url.pathname.startsWith('/supabase/')) {
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/recover') && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { resetRecipients.push(JSON.parse(body).email); res.end('{}'); });
    } else if (url.pathname.endsWith('/user') && req.method === 'PUT') {
      updates++;
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        correctPassword = JSON.parse(body).password === password;
        res.end(JSON.stringify(user));
      });
    } else if (url.pathname.endsWith('/user')) {
      if (authDenied) { res.writeHead(401); res.end(JSON.stringify({ code: 'bad_jwt', message: 'Invalid test session' })); }
      else res.end(JSON.stringify(user));
    } else if (url.pathname.endsWith('/logout')) { res.writeHead(204); res.end(); }
    else if (url.pathname.endsWith('/app_members')) res.end(JSON.stringify({ user_id: user.id, person: 'N' }));
    else { res.writeHead(404); res.end('{}'); }
    return;
  }
  if (url.pathname === '/sdk.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(sdk); return; }
  if (url.pathname === '/js/config.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end(`const CONFIG = { SUPABASE_URL: 'http://localhost:${server.address().port}/supabase', SUPABASE_ANON_KEY: 'fixture-public', AUTH_EMAILS: { N: 'n@example.test', V: 'v@example.test' }, PEOPLE: { N: { label: 'N' }, V: { label: 'V' } } };`);
    return;
  }
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  const type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'image/png';
  res.setHeader('Content-Type', type);
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) {
    // Nessuna dipendenza remota: il SDK reale viene servito dal server del test.
    body = body.toString().replace('<head>', '<head><style>*{box-sizing:border-box}.hidden{display:none!important}</style><script>window.tailwind={};</script>').replace(/<script[^>]*src="https:[^"]*"[^>]*><\/script>/g, '').replace('<script src="js/config.js">', '<script src="/sdk.js"></script><script src="js/config.js">');
  }
  res.end(body);
});
async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('https://**', route => route.abort());
    const page = await context.newPage();
    let pageErrors = 0;
    page.on('pageerror', () => { pageErrors++; });
    await page.goto(origin);
    await check('SDK v2: apertura normale conserva il login', async () => {
      await page.waitForFunction(() => authReady);
      assert(await page.locator('#landingScreen').isVisible());
      assert(!(await page.locator('#recoveryGate').isVisible()));
    });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await check('PWA: service worker v59 e app-shell attivi', async () => {
      assert(await page.evaluate(() => !!navigator.serviceWorker.controller));
      assert(await page.evaluate(async () => (await caches.keys()).includes('scorochiatu-shell-v59')));
    });
    for (const person of ['N', 'V']) await check('SDK v2 + PWA: richiesta link '+person+' solo al mapping senza sessione', async () => {
      await page.evaluate(person => selectUser(person), person);
      await page.locator('#authUsername').fill('other@example.test');
      await page.locator('#forgotPassword').click();
      await page.waitForFunction(() => !passwordResetBusy);
      assert.equal(resetRecipients.at(-1), person.toLowerCase()+'@example.test');
      assert((await page.locator('#passwordResetNotice').innerText()).includes('riceverai'));
      assert.equal(await page.evaluate(async () => (await sb.auth.getSession()).data.session), null);
      assert.equal(updates, 0);
      assert(!(await page.evaluate(() => authRecoveryRequested)));
      await page.evaluate(() => backToLanding());
    });
    await page.goto('about:blank');
    await page.goto(origin + '/#' + recoveryHash);
    await check('SDK v2 + PWA: callback recovery AMR '+amrMethod+' apre solo il reset verificato', async () => {
      await page.waitForFunction(() => !!authRecoveryIdentity);
      assert(await page.locator('#recoveryGate').isVisible());
      assert(!(await page.locator('#landingScreen').isVisible()));
      assert(!(await page.locator('#appRoot').isVisible()));
      assert(!(await page.evaluate(() => isAppAuthorized())));
      assert(await page.evaluate(() => !location.hash.includes('access_token')));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    });
    await page.reload();
    await check('SDK v2 + PWA: reload non ricrea recovery dal marker locale', async () => {
      await page.waitForFunction(() => document.getElementById('authNotice').textContent.includes('Recupero interrotto'));
      assert(await page.locator('#landingScreen').isVisible());
      assert(!(await page.locator('#recoveryGate').isVisible()));
      assert(!(await page.evaluate(() => isAppAuthorized())));
      assert.equal(updates,0);
    });
    await page.goto('about:blank');
    await page.goto(origin + '/#' + recoveryHash);
    await page.waitForFunction(() => !!authRecoveryIdentity);
    for (const id of ['newPassword', 'confirmPassword']) await page.locator('#' + id).fill(password);
    await page.locator('#recoverySubmit').click();
    await check('SDK v2: updateUser PUT unica, password intatta e logout locale', async () => {
      await page.waitForFunction(() => !authRecoveryRequested);
      await page.waitForFunction(() => document.getElementById('authNotice').textContent.includes('Password aggiornata'));
      assert.equal(updates, 1);
      assert(correctPassword);
      assert(await page.locator('#landingScreen').isVisible());
      assert(await page.evaluate(() => !localStorage.getItem('scorochiatu_auth') && !sessionStorage.getItem('scorochiatu_auth')));
      const stores = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
      assert(!stores.includes(password));
    });
    await page.goto('about:blank');
    await page.goto(origin + '/#error=access_denied&error_code=otp_expired&error_description=Link+expired');
    await check('SDK v2 + PWA: callback scaduto, errore controllato e reset disabilitato', async () => {
      await page.waitForFunction(() => document.getElementById('recoveryError').textContent.includes('scaduta'));
      assert(await page.locator('#recoveryGate').isVisible());
      assert(await page.locator('#recoverySubmit').isDisabled());
      assert(!(await page.evaluate(() => isAppAuthorized())));
      assert.equal(updates, 1);
    });
    await page.locator('#recoveryExit').click();
    authDenied = true;
    await page.goto('about:blank');
    await page.goto(origin + '/#' + recoveryHash);
    await check('SDK v2: token rifiutato online non permette reset o accesso', async () => {
      await page.waitForFunction(() => document.getElementById('recoveryError').textContent.includes('non valida'));
      assert(await page.locator('#recoverySubmit').isDisabled());
      assert(!(await page.evaluate(() => isAppAuthorized())));
      assert.equal(updates, 1);
    });
    await page.locator('#recoveryExit').click();
    authDenied = false;
    await check('SDK v2: SIGNED_IN con AMR '+amrMethod+' senza recovery non permette reset', async () => {
      await page.evaluate(async tokens => { await sb.auth.setSession(tokens); }, { access_token: jwt, refresh_token: randomBytes(32).toString('hex') });
      await page.waitForFunction(() => isAppAuthorized());
      assert(!(await page.locator('#recoveryGate').isVisible()));
      await page.evaluate(async () => { try { await updateRecoveryPassword(''); } catch (_) {} });
      assert.equal(updates,1);
      assert(!(await page.evaluate(() => authRecoveryReceived)));
    });
    assert.equal(pageErrors, 0);
    console.log(`Recovery SDK/PWA: ${checks}/${checks} PASS; nessun Supabase live`);
  } finally { await browser.close(); }
})().catch(error => { console.error('FAIL Recovery SDK/PWA: ' + error.name); console.error((error.stack || '').split('\n').filter(line => line.includes(__filename)).join('\n')); process.exitCode = 1; }).finally(() => server.close());
