#!/usr/bin/env node
'use strict';
// Real Supabase SDK, synthetic fetch only. No application config or live requests.
// Usage: node scripts/verify-production-sdk-envelope.cjs --sdk=/tmp/supabase-js.js
const assert = require('node:assert/strict');
const path = require('node:path');
const sdkPath = process.argv.find(arg => arg.startsWith('--sdk='))?.slice(6);
if (!sdkPath) throw Error('Provide --sdk= with a local Supabase SDK bundle; no network is used by this test.');
const SDK = require('node:vm').runInThisContext(
  require('node:fs').readFileSync(path.resolve(sdkPath), 'utf8') + '\nsupabase;', { filename: sdkPath });
const Production = require('../js/production-session.js');
const Transport = require('../js/snapshot/transport.js');
const fixture = require('./verify-production-shell.cjs').fixtureData();
const bootstrap = {
  bootstrap_contract_version: 1, outcome: 'OK',
  caller: { person_id: fixture.N, legacy_person: 'N' }, selected_group: { group_id: fixture.G },
  protocol: { client_protocol: 1, supported_protocol: 1, minimum_client_protocol: 1, snapshot_contract_version: 1 },
  runtime: { mode: 'target', activation_allowed: true }
};
let response = { status: 200, body: bootstrap }, checks = 0;
const requests = [];
const client = SDK.createClient('https://sdk-fixture.invalid', 'synthetic-public-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://sdk-fixture.invalid');
    assert(['/rest/v1/rpc/get_app_runtime_context', '/rest/v1/rpc/get_person_group_snapshot'].includes(parsed.pathname));
    assert.equal(options.method, 'POST');
    requests.push(parsed.pathname);
    if (response.throws) throw new TypeError('Synthetic network failure');
    return new Response(JSON.stringify(response.body), { status: response.status,
      statusText: response.status === 200 ? 'OK' : 'Synthetic error', headers: { 'Content-Type': 'application/json' } });
  } }
});
const check = (value, name) => { assert(value, name); checks++; console.log('PASS ' + name); };
(async () => {
  const previous = globalThis.sb;
  globalThis.sb = client;
  try {
    const raw = await client.rpc('get_app_runtime_context', { p_client_protocol: 1 });
    check(raw.status === 200 && raw.error === null &&
      Object.keys(raw).sort().join() === 'count,data,error,status,statusText,success', 'actual SDK reproduces the six production envelope keys');
    const rpc = Production.productionDependencies().runtime.rpc;
    const normalized = await rpc('get_app_runtime_context', { p_client_protocol: 1 });
    check(Object.keys(normalized).sort().join() === 'data,error' && normalized.data.outcome === 'OK', 'actual SDK normalized at production boundary');
    const transport = Transport.createTransport({ rpc });
    const decoded = await transport.bootstrap({ callerId: fixture.N });
    check(decoded.category === 'BOOTSTRAP_RESULT', 'actual SDK bootstrap passes strict domain decoder');
    response = { status: 200, body: fixture.raw };
    const snapshot = await transport.createSnapshotProvider(decoded).read({ callerId: fixture.N,
      groupId: fixture.G, contractVersion: 1, contextEpoch: 1, requestSequence: 1, reason: 'SDK_FIXTURE' });
    check(JSON.stringify(snapshot) === JSON.stringify(fixture.raw), 'actual SDK snapshot body preserved exactly');
    for (const [name, reply, expected] of [
      ['domain maintenance', { status: 200, body: { bootstrap_contract_version: 1, outcome: 'ERROR', error: { code: 'MAINTENANCE' } } }, 'MAINTENANCE'],
      ['HTTP401', { status: 401, body: { code: 'PGRST301', message: 'synthetic' } }, 'AUTH_INVALIDATING'],
      ['HTTP403', { status: 403, body: { code: '42501', message: 'synthetic' } }, 'AUTH_INVALIDATING'],
      ['HTTP503', { status: 503, body: { code: 'XX000', message: 'synthetic' } }, 'TRANSPORT_UNCERTAIN'],
      ['network failure', { throws: true }, 'TRANSPORT_UNCERTAIN'],
      ['null payload', { status: 200, body: null }, 'SERVER_CONTRACT_ERROR'],
      ['invalid domain payload', { status: 200, body: { ...bootstrap, unexpected: true } }, 'SERVER_CONTRACT_ERROR']
    ]) {
      response = reply;
      check((await transport.bootstrap({ callerId: fixture.N })).category === expected, 'actual SDK fails closed: ' + name);
    }
    console.log('REAL SDK ENVELOPE ' + JSON.stringify({ cases: checks, requests: requests.length,
      sdkReplyKeys: Object.keys(raw).sort(), liveAccess: false, applicationConfigLoaded: false }) + ' PASS');
  } finally {
    await client.auth.stopAutoRefresh();
    if (previous === undefined) delete globalThis.sb; else globalThis.sb = previous;
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
