# Telegram profiles and cloud storage

Wordflow remains a Telegram-only Mini App. One verified Telegram account owns
one profile containing its display name, avatar, words, dictionaries, progress
and preferences. Opening the public URL outside Telegram shows an invitation
to open @WordsENRUbot. No email, passwords or browser login are added.

Use the existing Sites project, with its existing audience and URL, and D1
binding `DB`. Add a Vinext server without rewriting the existing card interface.
Validate Telegram initData with the production Ed25519 public key, configured
bot ID and a maximum authentication age of 24 hours. No bot token is required.
Every database read and write derives its owner from verified initData.

Store each user's portable Wordflow document and an integer revision in D1.
Writes use an atomic revision comparison; conflicting devices must never
silently overwrite one another. Offer an explicit choice between the local
copy and the cloud copy, preserving a recovery copy before replacing data.

Keep a separate local cache per Telegram account. Existing browser data stays
in a legacy recovery copy and is imported only after the user chooses to do so.
Offline sessions must validate the signed, fresh Telegram credential locally
before selecting a profile cache. Pending changes
sync when connectivity returns. Show loading, saved, pending, offline, expired
login and conflict states in product language. Do not promise cloud saving when
only the local copy was written.

The profile screen shows name/avatar, custom word count, learned count and sync
status. Preserve button-only answers, tap-to-flip, sound, undo and JSON export.

Verify signature rejection, expiration, owner isolation, document limits,
atomic conflicting writes, offline recovery, legacy import and the existing
card interactions before publishing and pushing to EnCard.
