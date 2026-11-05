# S00 review acceptance — 2026-11-05 (G02)

Status: **local review recovery verified again; actual-host acceptance open**.
Tracks [G02 #32](https://github.com/engshort/fortnox-mcp/issues/32).

The [maintenance update](S00-hosted-maintenance-2026-11-05.md) deployed the
existing server-backed status and view recovery without replacing its database,
owner, grants or review configuration. No production financial operation exists.

On Linux, Node 24.19.0/npm 11.9.0, pinned Playwright 1.64.1 and its Chromium
156.0.8078.4, `npm run test:browser` passed **18 tests**: nine scenarios on desktop
Chrome and Pixel 7 emulation. The existing SQLite-backed loopback harness serves
the actual widget in a sandboxed iframe under script/style hash CSP with no
network allowance. Screenshots/results are outside Git under `/tmp`.

Checks cover keyboard approval, immutable result handling, one database-backed
consumption, concurrent/remounted views, replay/double-click rejection, the
actual 15-second lost-response timeout, read-only recovery, failed status reads,
expiry and Swedish/English controls. Browser error/warning assertions passed.
The 28 backend tests also passed, including real local workerd/D1, cross-era
OAuth authorization and one-time consumption, restart and privacy checks.

There is no paired Browser plugin or authenticated ChatGPT browser session on
this host, so the repository's Playwright harness was used. The initial launch
failed because system libraries were absent; the required Debian libraries
were extracted into `/tmp` and the suite passed with `LD_LIBRARY_PATH` pointing
there. No system packages or repository runtime configuration were changed.

This is not a mobile-device, second-browser-family or ChatGPT acceptance result.
In the real host, still verify restrictive custom-app CSP, displayed proposal,
owner action, exactly one consumed D1 record, remount/replay, expiry/lost response,
status outage and another browser. Verify that commit/status tools are absent
from the actual model catalog and capability material stays outside model
context. The conforming host remains trusted; visibility does not prove physical
human presence against a malicious host.

Keep #32 open and review-required financial execution disabled until actual-host
acceptance succeeds. Never treat an unavailable status as proof of failure or
automatically resend a commit.
