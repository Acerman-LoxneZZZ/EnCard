# Wordflow verification — 2026-09-27

Deliverable: `index.html`, standalone, with embedded fonts and icons.

Automated DOM integration: `node .impeccable/review/dom-check.cjs`.
The harness uses jsdom and mocks browser media preferences, timing, pointer
capture, storage errors, and speech. It does not render pixels or produce sound.

Passed groups:

1. Script execution, unique IDs, accessible references, no external runtime assets.
2. Unknown-card placement, duplicate-input lock and complete undo.
3. Hard-card scheduling, completion statistics, one-card repeat, restart.
4. Flip state, focus and accessible translation.
5. Library, Russian search, filters, empty state and isolated shortcuts.
6. Keyboard controls, help, persisted shortcut toggle and mobile return label.
7. Pointer thresholds, left/right swipes and cancellation.
8. Effects, reduced motion, word/example speech requests and unsupported speech.
9. Legacy save migration, invalid save recovery and denied storage.

Independent source review found and resolved a mobile accessible-name defect.
It also checked optional shortcut disabling, answer focus restoration and the
content-sized two-face grid. Its scoped disposition is ship after the library
button's accessible name was aligned with its visible text.

The Impeccable detector reported colored glows and the completion icon tile.
Colored glow is explicitly requested. The completion icon communicates success;
the reviewer did not classify it as a material defect. No broad suppressions added.

Browser rendering, actual device gestures, text zoom, compositing, and audible
system speech are not verified. The earlier file-URL browser security block was
not bypassed through another surface or protocol.

## 2026-09-28 card refinement

10 DOM test groups passed, including Russian-first recall without answer spoilers,
actual queued-word preview, downward hard swipe, cancellation, and repeat after
three other cards. Independent source reviewer: ship. Browser animation appearance
remains unverified. Main-screen tutorial captions were removed.

## 2026-09-29 conditional hints and overflow

11 DOM groups passed. New tests cover hard-only hints, three-step scheduling,
save/reload, undo, learned-word cleanup, unknown-only review without a hint,
accessible names without letter spoilers, and the parsed overflow:clip rule.
Scroll geometry and animation appearance remain unverified in a real browser.
Legacy saves preserve progress; old combined difficulty records are not guessed
to be hard answers.
