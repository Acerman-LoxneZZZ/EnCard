# Telegram Profiles Implementation Plan

> Execution: implement the tasks natively in this session; the user's latest
> instruction asks to proceed with the agreed Telegram-only design.

**Goal:** Persist personal words and progress for verified Telegram profiles.

**Architecture:** Retain the existing HTML interface, served by the Sites Vinext
starter. Authenticate API requests with signed Telegram initData; store a
versioned Wordflow snapshot in D1 and maintain per-user browser caches.

**Tech Stack:** Vinext, Cloudflare Workers, D1, Drizzle, browser JavaScript.

**Spec:** ../specs/2026-10-14-telegram-profiles.md

## Global Constraints

- Preserve Site project ID, public access, URL and the existing visual identity.
- No browser login, bot token, passwords or swipe answers.
- Require production signature validation and auth age <= 86400 seconds.
- Never replace another device's changes without explicit conflict resolution.

## Review Focus

- Forged or expired Telegram data: reject before touching D1.
- A second account on the same device: keep local caches separate.
- Two devices writing concurrently: one succeeds; the other sees a conflict.
- Network failure during save: retain the dirty local document.
- Legacy words on a new profile: offer migration without overwriting cloud data.

### Task 1: Authenticated storage API

Files: `server/telegram.mjs`, `server/document.mjs`, `server/profile.mjs`,
`app/api/profile/route.ts`, `db/schema.ts`, generated `drizzle/` migrations,
`scripts/profiles.test.mjs`, starter build and configuration files.

- [x] Scaffold the supported server starter alongside the existing app.
- [x] Add tests for signatures, dates, document validation and isolated writes.
- [x] Implement `verifyTelegram(initData, botId)` and profile GET/PUT handlers.
- [x] Generate schema migrations for profile ID, document and revision.
- [x] Run `node --test scripts/profiles.test.mjs` and build the Worker.

### Task 2: Profile and synchronization interface

Files: `public/profile-client.js`, `public/sw.js`, `app/route.ts`, `index.html`,
browser regression checks and product documentation.

- [x] Gate hosted app scripts until Telegram identification and cache selection.
- [x] Add the profile screen and status, preserving existing card controls.
- [x] Implement account-scoped caches, debounced saves and conflict recovery.
- [x] Offer legacy import; keep export and a recovery copy.
- [x] Verify offline behavior, two accounts, conflicts and card interactions.

### Task 3: Publish and preserve sources

- [x] Configure the provided numeric Telegram bot ID as a runtime variable.
- [x] Apply local migrations and validate the production artifact.
- [x] Push source to Sites, save and deploy the existing project.
- [x] Confirm D1 provisioning and API rejection of unauthenticated requests.
- [x] Commit and push the checked implementation to EnCard.

## Verification and remaining configuration

20 Node tests pass; TypeScript and Worker build pass. Browser checks cover mobile
and desktop, cloud writes, conflict choice, offline reload/reconnect, legacy
import, account switching and refusal to open an unverified cache. A separate
read-only review found two issues (offline identity and stale import state);
both were fixed, reviewed and given regression coverage.

The owner supplied numeric TELEGRAM_BOT_ID 7095007468; it is configured in Sites
runtime revision 1. Site version 5 deployed successfully. The live page returns
HTTP 200 and the correct bot ID; D1 binding DB contains the profiles table.
Anonymous and invalid-signature profile requests both return HTTP 401.
The browser scenarios use Telegram/API fixtures; a real signed Telegram session
is exercised when the user next opens the Mini App through @WordsENRUbot.

### Production bot ID correction

The first real Telegram launch failed signature verification. The owner then
confirmed bot ID 8693618810; the previous value 7095007468 was incorrect.
Updated TELEGRAM_BOT_ID in Sites runtime revision 2 and redeployed saved version
5 successfully. The production HTML, including the bot's existing ?v=3 URL,
now contains botId 8693618810. A real signed login still needs confirmation
from the user's Telegram client. No bot token was stored in project files
or configured in Sites.
