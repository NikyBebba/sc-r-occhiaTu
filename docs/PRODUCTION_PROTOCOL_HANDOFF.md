# Phase 4A9-C — production protocol negotiation

Local implementation/checkpoint; **NOT RELEASED / NOT DEPLOYED**. No Supabase access or
operational invocation occurred in this phase. Production remains v62,
legacy-authoritative, target dormant according to the operator's Unit 8 checkpoint.
B2/B3 under `/tmp/phase4a9-b2/` and `/tmp/phase4a9-b3/` remain frozen.
Permanent target group: `3e916de3-fbe9-4541-bc78-264ac2cfc218`.

The production entry formerly chose LEGACY unconditionally. It now requires a
positive online `read_app_protocol(1)` observation after verified Auth and
`app_members`. The existing database offers no safe pre-activation read surface:
`app_protocol_state` is private and target bootstrap EXECUTE is deliberately denied.
A permission error is never evidence of legacy authority.

## Required database contract — REVIEW ONLY

[Proposed SQL](../database/supabase-runtime-protocol-read-review.sql) is not an
authorized installer. It creates one authenticated-only, STABLE SECURITY DEFINER
SQL reader with empty search path. It returns protocol contract version, mode,
minimum client protocol and opaque authority epoch; no configuration/group/person
records or mutation capability. Unmapped identities, inconsistent effective grants,
unknown mode/floor and partial target grants produce ERROR. anon/service_role get
no new EXECUTE; no table grants or target bootstrap grants are added.

The reader checks effective table/column/function privileges (including inherited
access), browser role safety, protocol configuration and current group membership.
Absent configuration also requires empty Foundation and neutral night group/revision
state. The epoch includes protocol/catalog/role-membership transaction stamps and
server instance, so fence/restore cannot revive an earlier response merely because
permissions again look the same. It is an invalidation token, never client authority.

Adding a public function affects Unit 5's frozen graph audit. The candidate explicitly
replaces only its function-name and safe-function allowlists to include this reader;
its security mode, configuration, OID and grants are retained. This is a required,
separately reviewed database contract revision, not a claim that Units 1–8 remain
byte-identical. Expected public function count becomes 46. B2/B3 source/catalog/drain
manifests must be prepared as NEW artifacts and reviewed against that revision before
operational use. Do not edit or execute the frozen packages unchanged.

Before any client deployment: independently approve the SQL, prepare complete live
read-only pre/post gates, install once under separate authorization, verify exact
catalog/ACL delta and PostgREST RPC visibility, and revise future operational
manifests. No live probe has been made. **Deploying this client against today's
unchanged database would fail closed; it is not currently deployment-ready.**

## Authority contract

| Server evidence | Client authority |
|---|---|
| Configuration absent; Foundation empty; exact original legacy grants; target denied | LEGACY / floor 0 |
| Configuration absent; exact fence grants; target denied | READ_ONLY / floor 0 |
| legacy/0 bootstrap configuration, valid group, exact fence | READ_ONLY / floor 0 |
| read_only/0, valid group, exact fence, target denied | READ_ONLY / floor 0 |
| target/1, valid group, legacy fenced, all four target facades granted | TARGET / floor 1; fresh bootstrap required |
| read_only/1, valid group, legacy fenced, target facades retained | READ_ONLY / floor 1 |
| Malformed, unknown, unsupported, partial, network/permission/reader failure | UNAVAILABLE; no writer |

The accepted client protocol is exactly 1. The per-identity floor observed in this
page is monotonic, including logout/relogin. It is in-memory deny-only state; storage,
query strings and debug markers cannot select authority. A fresh page still requires
positive server evidence. Administrative changes remain under the B3 exclusion
boundary; the client does not prevent a DBA from changing the contract.

## Startup and handoff

`index.html` → Auth/session verification → `showApp()` →
`ProductionSession.startAuthenticated()` → protocol negotiation → exactly one
explicit ProductionHost child. The existing explicit coordinator factory remains a
component-test composition API, never a production URL/storage selector.

LEGACY starts the existing Store/channel/render path. TARGET constructs the existing
TargetRuntime → TargetIntegrationHost → TargetShell path and requires online
bootstrap/Snapshot acceptance. Auth restoration and relogin negotiate again.
Visibility/online Auth refresh rechecks protocol. Poll interval is 5 seconds, proof
lease 10 seconds, reader timeout 8 seconds, measured using a monotonic clock.
Suspension/expired proof cannot authorize a mutation.

Each legacy mutation and target command/Match dispatch rechecks the protocol online.
Generation tokens reject responses from retired authority, including a same-mode
fence/restore epoch change. Retirement revokes handles synchronously, stops channels,
clears views and awaits teardown before constructing a replacement. A hung target
bootstrap can be cancelled during retirement. A teardown failure blocks replacement. A proof that expires during teardown cannot
be renewed by the delayed creation of a child.
Target/bootstrap failure never creates a legacy child.

READ_ONLY and UNAVAILABLE hide the application and its mutation controls. A small
pause/unavailable panel offers retry and logout only. Reads are intentionally hidden
during transition; cached data is not used to manufacture a coherent mixed-authority
view. Resume requires a new target owner/bootstrap; it does not reuse old action
handles. Neither read_only/1 nor target/1 can negotiate legacy/floor 0 in the same
identity session.

The last server observation and a request cannot be atomic in a browser. A protocol
change may occur after a pre-write check. The installed fence/target RPC contracts
remain the final protection; drain handles already admitted legacy transactions.
No claim is made that polling itself revokes database authority.

## Old clients and PWA

Existing v62 tabs never learn target RPCs by a server switch. First fence rejects
new legacy writes; an already admitted transaction still needs drain. Activation,
maintenance and resume do not restore legacy write grants, so stale clients remain
unable to write. They must update before using target. Do not restore legacy authority
or lower the protocol floor to accommodate old code.

Candidate shell cache is `scorochiatu-shell-v64`; the complete protocol module graph
is precached. The DOM marker `protocol-v1-v64` is diagnostic only. The worker keeps
its waiting/activation strategy: no forced skipWaiting or mixed code injection.
Reloading one tab while another old client remains open can keep the old worker.
Close **all** app tabs and standalone PWA windows, then reopen online and confirm the
build marker/new worker and a successful protocol observation. Authentication does
not require forced logout, but restored sessions still renegotiate. Old executing
JavaScript cannot be forcibly replaced by a cache-name change.

Local PWA tests cover old multi-tab coherence, waiting worker, closing old clients,
new module precache, offline shell and failed-update preservation. Full offline
application capability is not claimed; online protocol proof is mandatory.

## Validation and release gates

New suites: `verify-protocol-session.cjs`, `verify-production-protocol.cjs`,
`verify-production-protocol-browser.cjs`, `verify-protocol-read-db.py`.
The browser gate serves synthetic configuration on loopback with a CSP denying all
external connections. PostgreSQL tests use only disposable local B3 fixture clones;
17.11 local success is not hosted 17.6 verification.

Evidence is under `/tmp/phase4a9-c/`. Protocol unit 33, real-entry VM 28, database 35,
Chromium real entry 28, WebKit real entry 28, PWA 17, smoke 436, Auth 82, Chromium Auth 43, preference
Store 77, SW 18, production shell 94, bridges 127, target runtime 44, integration host
93, action adapter 71, Match adapter 103, consumer facade 53 passed locally.

Native Safari was isolated in Phase 4A9-C1 as **ENVIRONMENT_GATE_BLOCKED**,
not an application failure and not a native Safari PASS. A standalone minimal test
imports no application code, starts a fresh `/usr/bin/safaridriver` on an ephemeral
free loopback port, receives HTTP 200 `ready=true` from `/status`, then receives
HTTP 500 from `POST /session` after 30,007 ms. No session ID is returned; no
navigation command is sent; the minimal page receives zero HTTP requests.
Driver version: Safari 27.0.1 (22625.1.29.11.28); macOS 27.0.1 (26A434).
Evidence: `/tmp/phase4a9-c1/minimal-safari-result.json`.

No existing safaridriver/listener was present at diagnosis. A fresh process/port
reproduces the failure, excluding a stale driver/session, port collision and app
harness/application code as explanations. Safari itself is running. Remote
Automation was enabled and readiness confirmed by the operator in Phase C; the
current error is a Safari-instance automation handshake timeout, not the prior
explicit Remote Automation denial. The test does not distinguish an unresponsive
Safari automation subsystem from a pending macOS/Safari authorization dialog.
No system preference was changed and no personal browser tab was inspected.

Operator remediation before a native rerun: save work, manually quit/reopen Safari,
resolve any initial/authorization dialogs, confirm Develop → Allow Remote Automation
and any macOS WebDriver authorization request, then rerun the standalone minimal
probe before the application gate. If it still fails, repair the matching Safari/
macOS automation environment using the recorded error/version. No application or
production permission should be relaxed. WebKit remains separate evidence.

C1 explicitly permits a local checkpoint with this conclusive pre-navigation
classification; native Safari execution remains unresolved for release validation.
Application-controlled C1 regression suites pass: protocol 33, real-entry VM 28,
production shell 94 (also classic-script check), bridges 127, target runtime 44,
integration host 93, action adapter 71, Match adapter 103, consumer facade 53,
Auth 82, preference Store 77, Chromium Auth 43, Chromium entry 28, WebKit entry 28,
PWA lifecycle 17/17 and service worker 18/18. The previous “17/18” wording combined
two different complete suites; there was no failed eighteenth PWA case. No PWA
assertion was removed, excluded or weakened. Expensive database migration suites
were not rerun in C1 because neither the SQL nor application code changed.

C1 validation/report evidence is under `/tmp/phase4a9-c1/`. B2/B3's 121 indexed
artifact hashes remain unchanged. The protocol-reader SQL SHA-256 remains
`b389ccd2ac4a5cfb4bbc14cf65e15eb9149657724bfb73352db384fc96950d42`.
Static review has zero blocker/high/medium findings. The existing untracked history
import work and generated browser/Python state are excluded from the checkpoint.

The additional DB contract remains REVIEW_ONLY. Independent authorization, hosted
capability/source/ACL review, live read-only pre/post gates, RPC visibility checks
and NEW B2/B3-compatible operational manifests are required before installation or
client deployment. Shared two-device/PWA production verification remains a later
separately authorized release gate. No push, deploy or operational migration
authorization is implied.
