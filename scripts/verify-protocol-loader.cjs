#!/usr/bin/env node
'use strict';
// Browser-focused presentation check for the production protocol gate.
// Usage: node scripts/verify-protocol-loader.cjs --playwright=/path/to/playwright-core
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const arg = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
const { chromium } = require(arg('playwright') || 'playwright');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const gate = html.match(/<section id="protocolGate"[\s\S]*?<\/section>/)?.[0];
if (!gate) throw new Error('protocolGate markup not found');
if (!html.includes('data-client-build="protocol-v1-v75"')) throw new Error('Expected integer v75 client marker');
if (!gate.includes('fa-solid fa-film protocol-entry-film')) throw new Error('Verified existing film icon missing');
if ((gate.match(/class="[^"]*fa-solid fa-film/g) || []).length !== 1) throw new Error('Loading gate must contain one film icon');
if (!fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8').includes("const CACHE_REV = 'scorochiatu-shell-v75'")) throw new Error('Service worker cache marker is not v75');
if (!gate.includes('Prepariamo la sala…') || !gate.includes('Il prossimo ciak è per voi.')) throw new Error('Loading copy/footer changed');

const server = http.createServer((req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (file === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="it"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><script src="/theme.js"></script><style>.hidden{display:none!important}</style></head><body>${gate}<script>window.retryCalls=0;window.logoutCalls=0;window.ProductionSession={retryStartup(){window.retryCalls++}};window.logout=()=>window.logoutCalls++;</script></body></html>`);
  } else if (file === '/style.css' || file === '/theme.js') {
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(fs.readFileSync(path.join(root, file === '/style.css' ? 'css/style.css' : 'js/theme.js')));
  } else { res.statusCode = 404; res.end(''); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let checks = 0;
  const check = (condition, message) => { checks++; if (!condition) throw new Error(message); };
  try {
    const page = await browser.newPage();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: width < 400 ? 640 : 900 });
      for (const theme of ['primavera', 'cinema', 'autunno', 'estate', 'pasqua', 'halloween', 'natale', 'capodanno']) {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.evaluate(name => setTheme(name), theme);
        const result = await page.evaluate(() => {
          const section = document.getElementById('protocolGate');
          section.classList.remove('hidden');
          const scene = section.querySelector('.auth-scene').getBoundingClientRect();
          const content = section.querySelector('.protocol-entry-content').getBoundingClientRect();
          const panel = section.querySelector('.protocol-entry-ticket');
          const icon = section.querySelector('.protocol-entry-film');
          const dots = section.querySelector('.protocol-entry-dots');
          return {
            xOverflow: document.documentElement.scrollWidth > innerWidth,
            contentCenterDelta: Math.abs((content.top + content.bottom) / 2 - (scene.top + scene.bottom) / 2),
            noPanel: getComputedStyle(panel).borderTopWidth === '0px' && getComputedStyle(panel).boxShadow === 'none',
            iconVisible: !!icon && getComputedStyle(icon).display !== 'none',
            dotsVisible: !!dots && getComputedStyle(dots).display !== 'none',
            footerVisible: !!section.querySelector('.auth-footnote') && section.querySelector('.auth-footnote').getBoundingClientRect().height > 0,
            bodyColor: getComputedStyle(document.documentElement).getPropertyValue('--color-sala').trim()
          };
        });
        check(!result.xOverflow, `no horizontal overflow at ${width}px / ${theme}`);
        check(result.contentCenterDelta < 8, `centered at ${width}px / ${theme}`);
        check(result.noPanel, `large panel removed at ${width}px / ${theme}`);
        check(result.iconVisible && result.dotsVisible && result.footerVisible && result.bodyColor, `loader, activity dots and footer visible at ${width}px / ${theme}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 640 });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await page.locator('.protocol-entry-dots i').first().evaluate(el => getComputedStyle(el).animationDuration);
    check(parseFloat(reduced) < 0.001, 'reduced-motion disables dot animation');
    await page.evaluate(() => {
      document.getElementById('protocolGate').classList.remove('hidden');
      document.getElementById('protocolGateLoader').classList.add('hidden');
      const icon = document.getElementById('protocolGateIcon'); icon.className = 'fa-solid fa-circle-exclamation';
      document.getElementById('protocolGateTitle').textContent = 'La sala non è ancora pronta';
      document.getElementById('protocolGateMessage').textContent = 'Connessione o verifica momentaneamente non disponibile.';
      document.getElementById('protocolGateRetry').classList.remove('hidden');
      document.getElementById('protocolGateLogin').classList.remove('hidden');
    });
    check(await page.locator('#protocolGateLoader').isHidden(), 'loader hidden in error state');
    check(!(await page.locator('#protocolGateIcon').evaluate(el => el.classList.contains('hidden'))), 'error icon revealed by status class');
    check(await page.locator('#protocolGateMessage').isVisible(), 'error message visible');
    check(await page.locator('#protocolGateRetry').isVisible() && await page.locator('#protocolGateLogin').isVisible(), 'retry and login actions visible');
    await page.locator('#protocolGateRetry').click();
    check(await page.evaluate(() => window.retryCalls) === 1, 'retry action remains wired');
    await page.locator('#protocolGateLogin').click();
    check(await page.evaluate(() => window.logoutCalls) === 1, 'login action remains wired');
    console.log(`Protocol loader browser verification: PASS (${checks} assertions; 4 widths × 8 themes, error/retry and reduced motion)`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
