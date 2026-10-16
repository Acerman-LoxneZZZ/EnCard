# Wordflow Library, Word Management and Weekly Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement approved proposals 2, 3, 9 and 10: dictionary overview, word details/actions, custom-word editing/deletion and seven-day profile statistics.

**Architecture:** Retain the existing HTML study UI and numeric queue IDs. Add storage-free shared model/activity modules and a separate library controller; migrate portable profiles to version 2 with persistent word keys and bounded answer history. Keep the existing Telegram verification, account-scoped cache, revision checks and D1 JSON column.

**Tech Stack:** Vanilla JavaScript, HTML/CSS, Node.js >=22.13.0, node:test, existing Playwright runtime, Vinext/Cloudflare Workers and D1. No new product dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-library-word-management-weekly-stats.md` (confirmed by user on 2026-10-16).

## Global Constraints

- «Основной пользователь — русскоязычный человек, занимающийся английским короткими сессиями на телефоне в Telegram.»
- «Фон #0d1018; текст #f4f2fa; вторичный текст #a7a9bc; акцент #c4b6f5.»
- «Сохраняются тёмная палитра, Manrope, DM Serif Display на учебной карточке, мягкая глубина, лавандовый акцент и существующие анимации карточки.»
- «80 и 120 символов, непустые значения после обрезки пробелов.»
- «История начинается с обновления, без восстановления прошлых дат из attempts.»
- «Хранятся последние семь календарных дней, максимум 5000 последних событий».
- «Лимит документа 1 MiB сохраняется»; never truncate words, dictionaries, preferences or sessions to fit history.
- «Области касания не меньше 44 px.» Honor reduced motion, Telegram safe areas and keyboard focus.
- «Повторения по расписанию, новые режимы тренировки, короткие сессии, уведомления и публикация на рабочий хостинг в этот объём не входят.»
- Preserve pre-existing edits to index.html, DESIGN.md and review scripts. Stage only this feature's changes; never reset the checkout or commit unrelated changes.

## Review Focus

1. Storage quota or a write failure halfway through a mutation must not leave word IDs and queues inconsistent (Task 3).
2. Closing the word panel during speech, switching accounts, or pressing Telegram Back must not evaluate a hidden card (Tasks 2 and 4).
3. A DST transition, midnight, or travel to another timezone must not duplicate an event or manufacture an active day (Tasks 1 and 5).
4. Recreating a deleted word with the same spelling must not attach old learning history to its new identity (Tasks 1 and 3).
5. A v1 device or an in-flight old save must not silently discard v2 keys/history, or acknowledge unsaved new changes (Task 2).

---

## File Structure and Loading

- Create `public/wordflow-model.js`: pure v1/v2 normalization, validation and immutable word/collection transformations.
- Create `public/wordflow-activity.js`: pure event recording, pruning and weekly summaries.
- Create `public/wordflow-library.js` and `public/wordflow-library.css`: overview, word panel and selection UI, driven by an adapter into the existing app.
- Modify `index.html`: minimal controller hooks, persistence transaction, answer/undo instrumentation and loading these local scripts.
- Modify `app/route.ts`: map script URLs beginning `./public/` in the standalone HTML to hosted root URLs. Retain deferred authenticated execution of the app's inline scripts.
- Modify `public/profile-client.js`, `public/profile-sync.js`, `public/profile.css`: profile migration, weekly presentation and synchronization.
- Modify `server/document.mjs`: validate and preserve v2; retain v1 read/write compatibility.
- Modify `public/sw.js`: cache version and new assets.
- Create `scripts/wordflow-model.test.mjs`, `scripts/wordflow-activity.test.mjs`, `scripts/wordflow-mutations.test.mjs`; extend `scripts/profiles.test.mjs`.
- Create `.impeccable/review/library-management-check.cjs` using the existing browser runtime and Telegram/API fixture pattern.
- Update `PRODUCT.md`, `DESIGN.md`, `README.md` after implementation.

The two pure modules are classic-script IIFEs exposing frozen `globalThis.WordflowModel` and `globalThis.WordflowActivity` namespaces. They perform no DOM or storage access. Node tests/server load them as side-effect imports and bind these namespaces locally. This keeps direct file-based HTML checks working without adding a bundler or a second implementation. The library script defines `window.WordflowLibrary.mount(adapter)` without mounting until authenticated app initialization. Hosted modules load before the deferred app bootstrap; standalone URLs resolve into the local public directory.

## Shared Data and Interfaces

`DocumentV2` retains all v1 fields, adds `key` to custom words and adds `activity`:

```text
activity = {startedAt: number, events: AnswerEvent[], truncated: boolean}
AnswerEvent = {id: string, at: number, date: 'YYYY-MM-DD', wordKey: string,
               en: string, ru: string, kind: 'yes'|'no'|'hard'}
key = 'builtin:' + en | 'legacy:' + encodeURIComponent(originalEn.trim().toLowerCase())
      | 'custom:' + crypto.randomUUID()
```

Built-in keys are derived, never stored as a replacement for builtinWords. Legacy keys are persisted on first migration. Translation/case edits preserve keys; new words always get a UUID. A generated key is at most 750 UTF-16 code units; event ID at most 100; en/ru use existing field limits. Keys and event IDs must be unique in their respective sets. `startedAt` and `at` are nonnegative safe-integer Unix milliseconds within JavaScript's Date range. An event's stored date must be a real calendar date and differ by at most one date from its UTC timestamp (device timezone); future events beyond 24 hours are rejected. `startedAt` is the first migration/collection timestamp and survives imports and pruning.

The event keeps the original label after later edits/deletion. Aggregate by wordKey; for a ranked word use its latest event's labels. The seven-day window uses local date components with calendar arithmetic, never milliseconds divided by 86400000. Capture date once when answering; a timezone change does not rewrite old event dates. A day is active only if retained events exist for that date. The activity API receives `now` explicitly for deterministic tests.

Document validation rejects malformed or oversized received history; it never silently prunes an imported/cloud document. The client prunes its own history before snapshot/write and exposes truncation. Keep version 1 responses as version 1 until the current client explicitly migrates and writes v2, preserving legacy tests. Once a profile stores v2, reject an attempted v1 downgrade with a recoverable update-required error; do not interpret a downgrade as an empty history.

### Task 1: Shared v2 Model and Activity Algorithms

**Files:** Create both pure modules and their two test files; modify server/document.mjs only when integrating validation in Task 2.

**Interfaces:**
- `WordflowModel.normalizeDocument(input, now): DocumentV2` validates v1/v2 and deterministically migrates legacy keys; throws `Error` with `code` (`invalid_document` or `too_large`).
- `WordflowActivity.emptyActivity(now): Activity`.
- `WordflowActivity.recordAnswer(activity, event, now): Activity` rejects duplicate event IDs; returns a new value.
- `WordflowActivity.removeAnswer(activity, eventId, now): Activity` is idempotent and also handles a pruned event.
- `WordflowActivity.fitDocument(document, now, protectedEventId = null): DocumentV2` prunes out-of-window/oldest events, keeps at most 5000 and <=1048576 UTF-8 bytes; preserves the protected newest event or throws `too_large`.
- `WordflowActivity.summarizeWeek(activity, now): {days, activeDays, uniqueWords, answers, difficultWords, truncated, startedAt}`; days contains exactly seven `{date, answers}` entries, difficultWords at most five `{wordKey,en,ru,count}`.

- [ ] **Step 1: Write failing tests** in the two test files. Assert: v1 migration leaves numeric sessions deeply equal; two migrations produce identical legacy keys; a 7-day summary of two events for one key in two decks has uniqueWords=1 and answers=2; removing one event makes answers=1; no events gives activeDays=0 and seven zero bars. Validate malformed/duplicate keys/events and prototype-like strings as data, never object keys with behavior.
- [ ] **Step 2: Run** `node --test scripts/wordflow-model.test.mjs scripts/wordflow-activity.test.mjs`; expect missing module/API failures.
- [ ] **Step 3: Implement** the APIs and limits above. Use `TextEncoder` for document bytes; sort retained events by timestamp then ID; preserve explicit truncated once history was evicted by capacity.
- [ ] **Step 4: Add boundary tests** with an injected clock: just before/after midnight, Europe/Berlin DST boundary using separate Node processes with TZ, timezone changes leaving captured dates intact, 5001 events retaining the latest 5000, >1 MiB with a protected newest event, oversized non-history payload throwing, changed/recreated word keys staying distinct. Assert tie ordering is English alphabetical and only no/hard contribute difficulty.
- [ ] **Step 5: Run** both test files; expect all pass. Commit only new model/activity modules and tests: `feat: add portable word identities and weekly activity model`.

### Task 2: End-to-End Persistence and Safe Migration

**Files:** Modify app/route.ts, index.html, server/document.mjs, server/profile.mjs, public/profile-sync.js, public/profile-client.js, public/sw.js and scripts/profiles.test.mjs.

**Interfaces:** Consume Task 1 APIs. Add `wordflow.activity.v1` to DATA_KEYS without reordering the existing four entries. `window.WordflowData.snapshot(): DocumentV2` and `validateBackup(input): StorageValues` must use the same model. Add `window.WordflowData.getWeeklyStats(now = Date.now())` and `closeOverlays(): boolean` (true if it closed a panel). `WordflowStorage.transaction(values, apply): boolean` persists a complete replacement of the account's values once, calls apply only after persistence succeeds, then schedules synchronization from the new live state. On failure it leaves the live state and account cache unchanged. Standalone storage uses recovery plus rollback for all affected keys before calling apply.

- [ ] **Step 1: Write failing profile tests**: round-trip v2 retains keys/events; v1 remains readable and migrates without progress changes; dirty comparison detects activity-only changes; old in-flight acknowledgment stays dirty; v1 PUT over stored v2 fails without modifying revision/document. Assert an account's activity is never returned for another account.
- [ ] **Step 2: Run** `node --test scripts/profiles.test.mjs`; new cases fail, existing authentication/isolation cases remain valid.
- [ ] **Step 3: Implement** shared normalization in backup import/export and server validation, activity storage, atomic account-value transaction, and first-migration recovery. If recovery cannot persist, stop migration and show recovery guidance. Detect normalized snapshot differences at boot and mark them dirty so an existing v1 profile really upgrades. Reject downgrade before UPDATE and retain revision checks.
- [ ] **Step 4: Integrate** recordAnswer into accepted rate() exactly once before save; keep previous event ID alongside previous session. undo() removes that event; restart() preserves activity. Clear undo when a data mutation invalidates its session. Route error codes into existing localized save/status messages. Extend recovery-download construction and legacy-import paths to carry the activity key.
- [ ] **Step 5: Update** HTML resource loading and the route mapping described above. Increment Service Worker cache to `wordflow-profiles-v3` and include all new JS/CSS resources. Pure namespaces may load before auth; personal data and mounting remain gated by verified account selection.
- [ ] **Step 6: Run** `node --test scripts/profiles.test.mjs scripts/wordflow-model.test.mjs scripts/wordflow-activity.test.mjs scripts/card-input.test.mjs scripts/word-list.test.mjs`; expect all pass. Commit this task's hunks: `feat: migrate Telegram profiles and synchronize answer history`.

### Task 3: Immutable Word Operations and Transactional App Adapter

**Files:** Extend public/wordflow-model.js; create scripts/wordflow-mutations.test.mjs; modify index.html.

**Interfaces:** Consume DocumentV2 from Task 1. Produce:
- `WordflowModel.editWord(document, wordId, {en,ru}, transcriptionFor): {document, resetProgress}`.
- `WordflowModel.deleteWord(document, wordId): DocumentV2`.
- `WordflowModel.addWordsToCollections(document, wordIds, collectionIds): DocumentV2` (additive; existing members never removed).
- `WordflowModel.repeatWord(document, wordId, collectionId): DocumentV2`.
- Existing app adds `commitDocument(next): boolean`; it writes atomically before replacing WORDS/sessions/collections/activity, stops speech, resets stale undo, renders once and reports failures without losing edits.

- [ ] **Step 1: Write failing mutation tests**. Delete the middle of three custom words appearing in all/overlapping/active/completed decks; assert every numeric reference remaps, no duplicates appear, remaining queues/keys persist, and empty decks survive. Translation and case-only edits keep learned state; replacing English resets only that word in every containing deck and clears IPA/audio cache before new lookup. Reject built-in edits/deletes, empty/oversized inputs and case-insensitive duplicates.
- [ ] **Step 2: Run** `node --test scripts/wordflow-mutations.test.mjs`; expect missing operation failures.
- [ ] **Step 3: Implement** immutable transformations, deriving own wordId as BUILTIN_COUNT + custom index. Preserve attempts/streak/bestStreak and other words' states; repeat moves one queue ID to its front and removes it from learned. For a changed English identity, remove this ID from learned/difficult/hinted and append it once to each containing queue. Existing activity stays unchanged.
- [ ] **Step 4: Add tests**: deleting then re-adding identical spelling produces a new key; repeated additive bulk membership is idempotent; repeat affects only selected deck and produces no activity; a simulated second-key standalone write failure rolls back all values and leaves live state unchanged; failed rollback retains the recovery copy and displays an actionable failure.
- [ ] **Step 5: Integrate** commitDocument and a library adapter in index.html. Adapter supplies `snapshot`, `commitDocument`, `transcriptionFor`, `speakWord(wordId, button)`, `studyCollection`, `createCollection`, `renameCollection`, `notify`, `isBusy`, `setOverlayOpen`. Give add-one/add-list stable UUIDs at creation; clear cached recording when the normalized English spelling changes.
- [ ] **Step 6: Run** all Node suites from Task 2 plus wordflow-mutations.test.mjs; expect all pass. Commit the task's hunks: `feat: edit delete and organize words without losing deck progress`.

### Task 4: Dictionary Overview, Word Panel and Multi-Selection

**Files:** Create public/wordflow-library.js and public/wordflow-library.css; modify index.html and public/profile-client.js; create .impeccable/review/library-management-check.cjs.

**Interfaces:** `WordflowLibrary.mount(adapter): {openOverview(), openCollection(id), closeOverlay(): boolean, hasOverlay(): boolean}` consumes the Task 3 adapter. Library modes are overview / collection; word panel is a native dialog styled as a bottom panel below 600px and a centered dialog otherwise. No nested interactive elements in row buttons.

- [ ] **Step 1: Write failing browser scenarios** using profiles-check.cjs fixture conventions, UI-only auth stub, real validateDocument and isolated accounts. Assert overview order/search/empty state; open, continue and restart labels; retain fast study selector and add-one/add-list flows. Start the development server with `npm.cmd run dev -- --port 4173` if no task-owned server is running; run `node .impeccable/review/library-management-check.cjs`; expect new controls absent.
- [ ] **Step 2: Read** project frontend-design, Impeccable context if not loaded in this session, and craft-floor.md immediately before UI edits. Implement the overview with distinct Open and Study controls and readable long-name wrapping. Preserve palette/fonts/motion from spec and current uncommitted card changes.
- [ ] **Step 3: Implement** word details, selected-deck status, sound, additive dictionary checkboxes, repeat, edit form, delete confirmation and remove-membership action. Inputs have labels and inline errors; drafts survive validation failures. Only custom words expose mutation actions. After deleting, focus the next available row or collection heading.
- [ ] **Step 4: Implement** multi-selection with persistent selection across search, selected count and additive target picker; exit clears selection. Create/rename, empty decks and absent personal collections have explicit next actions.
- [ ] **Step 5: Extend browser assertions**: close/Escape/Telegram Back restores focus; backdrop panel traps focus; busy card cannot open conflicting editor; audio cancels on close/change; hidden-card hotkeys do nothing; profile opening closes library overlays. Test repeated open/close, deleted trigger, long translations, 500 words, 1000 dictionaries and keyboard navigation. Call existing back handler through a shared single priority dispatcher: overlay, collection, overview, then study/profile.
- [ ] **Step 6: Run** `node .impeccable/review/library-management-check.cjs` and `node .impeccable/review/word-list-check.cjs`; expect passing behavior assertions. Commit new files and only this task's app/profile hunks: `feat: add dictionary overview and accessible word management`.

### Task 5: Weekly Profile, Verification and Product Documentation

**Files:** Modify public/profile-client.js, public/profile.css, .impeccable/review/library-management-check.cjs, PRODUCT.md, DESIGN.md, README.md.

**Interfaces:** Profile consumes WordflowData.getWeeklyStats and current word keys; resolving a difficult-word action uses its key, never an obsolete numeric ID. Recompute on profile open, data commit, local day change and Telegram activation.

- [ ] **Step 1: Add failing browser assertions**: new profile has empty-state copy; three accepted answers including two for one word show answers=3 and uniqueWords=2; undo removes only its answer; deleted difficult word retains label without an open action; two accounts have distinct charts. Inject clock for midnight/day rollover and verify exactly seven date labels.
- [ ] **Step 2: Implement** the profile's seven bars, active-day/unique-word/answer totals and up to five difficult words; add accessible textual chart summary, startedAt context and appropriate truncation copy (5000 limit versus byte-budget eviction). Keep synchronization/conflict/recovery actions reachable. Use the existing profile layout rather than an independent dashboard.
- [ ] **Step 3: Run** `node --test scripts/profiles.test.mjs scripts/card-input.test.mjs scripts/word-list.test.mjs scripts/wordflow-model.test.mjs scripts/wordflow-activity.test.mjs scripts/wordflow-mutations.test.mjs`, then `npm.cmd run build`. Expect passing suites and production build. Stop the task-owned development server before starting production preview with `npm.cmd start -- --port 4173`; run `node .impeccable/review/profiles-check.cjs` and `node .impeccable/review/library-management-check.cjs`. Offline checks use a real cached preview after initial verified login; confirm new assets/profile history survive reload offline.
- [ ] **Step 4: Inspect one batched capture** at 360/390px mobile and 1280px desktop: overview, collection, populated/empty profile, view/edit/delete panel, long content, keyboard-height viewport, reduced motion and Telegram safe area. Assert no horizontal overflow and >=44px targets. Fix findings in one batch and confirm once more at most. Do not claim real Telegram or visual verification unless actually performed.
- [ ] **Step 5: Update** product/design/readme with v2 backup compatibility, history retention, key/edit/reset semantics, delete behavior and local verification commands. Run `git diff --check`; record actual checks and material limits. Commit feature-owned hunks: `feat: show weekly learning statistics and verify library workflows`.

## Plan Self-Review

- Spec coverage: overview and navigation (4); word panel and bulk addition (3–4); edit/delete preservation (3); history/profile (1–2,5); compatibility/offline/conflict (2,5); documentation and visual floor (5).
- All cross-task API names, data fields, return shapes and adapter methods are declared above. Node and UI consume the same algorithms.
- All five Review Focus classes have explicit owning-task tests. Behavior checks precede implementation; build and visual review happen after integration.
- No publication, notification work, learning scheduler, application rewrite or extra dependencies are planned.
- Existing checkout changes remain in place. Feature commits must use selective staging for shared files.

## Execution Handoff

Status: prepared for user review; implementation has not started.

Choose after reviewing this plan:
- **Native (recommended):** implement the five tasks in order in this chat, then one fresh final code review. The interfaces are sequential and most changes share the same legacy HTML controller, so one implementer reduces concurrent-edit risk.
- **Subagent-driven:** one implementer/reviewer pair per task followed by final review. Useful for independent checkpoints; higher coordination overhead on shared files.

Do not begin implementation until the user approves this plan and selects the method. Read the selected execution skill if available; the plan remains the executable contract and all required tests/review gates remain in force.
