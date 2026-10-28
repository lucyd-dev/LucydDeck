# A page artifact owns its bytes, its CRC and its identity

A page used to be re-derived at every stage. `StorageService.pageHash` serialised and hashed a page for the listing, `SyncService` did it again while scanning and a third time while uploading, and the direct upload channel did it with a comment saying "canonicalize exactly like `SyncService` so the device CRC matches". Four spellings of one rule cannot drift without a type error, and the page the deck received could disagree with the page Review had compared. Page identity was interpolated at each call site, and a stored name and a new name were checked by the same rule even though a name already on the card only needs to be a safe path.

`shared/artifact.ts` now holds the value object. `PageArtifact` carries the page's `PageIdentity`, the canonical page it came from, its canonical JSON bytes and the CRC-32 of the padded stream the deck receives. Carrying the page lets the sync's reference scan read it without parsing the bytes back. `createPageArtifact(profile, id, page)` is the only place that turns a page into upload bytes: it validates, canonicalises, stringifies and hashes in one call. Storage, sync, Review and the upload channel derive from that one artifact, so no upload path can send bytes the listing did not hash. `DeviceService.uploadPage(artifact)` and `SyncDeviceClient.uploadPage(artifact)` are the only upload signatures; `StorageService.pageHash` is gone, and `listPages` reads each page through the factory and still lists an invalid page without a hash. Each caller keeps its own error type: `StorageService.loadPageArtifact` throws `StorageError`, the sync scan and execute rethrow it as `SyncError` with today's `SYNC_INVALID_PAGE` text, and the register handler reports the storage error.

The CRC is never recomputed on the way out. A plan keeps `{profile, id}` references and `executePlan` rebuilds the artifact at upload time, as before: an edit between reconcile and execute uploads the new bytes and the next reconcile settles the difference. Recomputing the CRC separately from the uploaded bytes is exactly the gap this removes, so there is no second hash to compare against.

The factory lives in `shared/` because it is pure: the renderer, the main process and the tests all see the same bytes. `Crc32` moves to `shared/types.ts` as one number type from storage to IPC to the deck lists, and the crc helpers live in `shared/crc32.ts` rather than in a USB folder. Icons keep `StorageService.iconHash` as bytes-in/CRC-out: a PNG has no canonical form to remove, so a second value object would add a name and a null path without deleting a derivation.

Two related rules keep the same shape. `shared/names.ts` has explicit `"new"` and `"existing"` modes: a new profile or icon name is sanitised and must pass the firmware grammar, while a stored name (`v1.2`, `Gaming: Room`, `logo.png`) is only checked for path safety, so a name from before the grammar still lists, deletes, renames and activates. `shared/identity.ts` is the one union of the strings the wire carries: page, icon, profile and rename. The artifact builds the page identity for a file transfer, which reserves the start payload's target byte. The rename case owns the `old:new` form because the firmware splits on the first colon; a pre-grammar rename half that itself contains `:` is therefore unaddressable, and that behaviour is recorded here rather than fixed.

## Considered options

- **Re-derive the page at each call site.** This is the state the ADR replaces: the equality of the listing hash, the uploaded bytes and the wire CRC depends on four implementations staying identical.
- **Keep the hash in `StorageService` and pass bytes alongside.** It still allows a caller to upload bytes that were not the ones hashed, which is the failure this work removes.
- **Put the artifact in `electron/main`.** The renderer and the pure tests could not share the canonical form, and the next renderer-side comparison would grow another spelling.
- **A value object for icons too.** There is no canonicalisation to centralise, so it would only rename a byte-to-CRC helper.
- **Snapshot the plan with its bytes.** It makes Review's numbers describe a library that may have changed before the upload; re-deriving keeps the plan a reference and `executePlan` the single place bytes are read.
- **One name rule for stored and new names.** It rejects pre-grammar deck names that the firmware still lists and deletes, and silently changes a user's rename target.
- **Branded hash and identity types.** They add casts at every boundary without removing a derivation, since the CRC and identity already have one owner.

## Consequences

- `PageArtifact` is the only thing the device upload accepts; a loose `(profile, id, json)` call no longer type-checks.
- A page that fails validation still lists without a hash, so the sync does not mistake it for a device-only page, and a reconcile that finds it aborts with the same `SYNC_INVALID_PAGE` text as before.
- A page whose identity cannot fit one file-transfer frame has no artifact either: it lists without a hash and the sync refuses it with the identity reason. The alternative is a hash for a page that can never be uploaded, which Review would then promise to send.
- The canonical form and the padded-stream CRC are frozen by one fixture in `shared/artifact.test.ts`; a change to either fails there before it reaches a deck.
- `shared/artifact.ts` and `shared/identity.ts` are named in the shared entry of `AGENTS.md`'s code map.
- Device list hashes remain untrusted JSON parsed through `crc32FromWire`, with `null` meaning "unreadable" rather than "absent".
