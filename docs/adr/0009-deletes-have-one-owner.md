# A delete has one main-side owner and takes the deck write lock

A two-sided delete used to be coordinated by the renderer: it sent the deck delete, then called a library delete through a callback. If the library side failed, the deck copy was gone, the library copy was present, and no result recorded the disagreement. A direct delete also bypassed `DeviceLock`, because the handlers only checked `lock.updating`, so a delete could interleave with a sync at USB-frame granularity.

All three deletes now belong to a main-side `DeleteService`: `deletePage`, `deleteIcon` and `deleteProfile`. Each takes the deck write lock, sends the deck delete first with `allowMissing` (a missing deck file or profile is success), then deletes the library copy, and returns `DeleteResult { deck, library, remaining }`. Profile delete is now two-sided as well; ADR-0005's consequence that it stays one-sided is amended. The renderer confirms, calls one channel, and applies the in-memory aftermath — autosave, history, selection, default profile — but never coordinates the two sides or retries one of them.

`DeviceLock` gains a `write` activity. It is taken at the IPC or use-case boundary, not inside `DeviceService`, because a sync calls `DeviceService` while holding `sync` and those calls must not look like a competing write. Every handler that mutates the deck takes it: create, rename, delete and activate profiles; activate a page; upload a page or icon; delete a file. Connect and disconnect, and the reconcile reads, stay outside. A write is refused with `DEVICE_BUSY` while a sync or an update owns the deck and is not queued. The renderer disables deck-writing controls while `usb.syncing` or a firmware operation is installing, so the normal path never sees the refusal. Sync and update remain exclusive and fail-fast.

`DeleteResult` carries `deck` and `library` as `{ status, error? }`, with status `deleted | missing | skipped | failed` (`missing` only deck-side), and `remaining` as `none | deck | library | both`. A transaction that ran, including one side failing, returns `{ ok: true, data }`; `{ ok: false }` is reserved for a request that never ran, such as an invalid name. A delete that starts with the deck disconnected skips the deck and deletes the library. One whose deck delete fails after starting aborts before the library copy, so a retry starts from a whole state. Device → Files keeps its deck-only delete, where a missing file is still an error, now under the write lock.

## Considered options

- **Leave the renderer as coordinator.** It cannot hold a lock across the two sides or return one result, and the failure that motivates this ADR stays possible.
- **Put the use cases on `DeviceService`.** It would mix library ownership into the deck service, and the sync's calls into it would need a special token to avoid looking like competing writes.
- **Queue a delete behind a running sync.** It holds a user action across a sync that can run for minutes, needs a waiting state plus cancel or timeout, and hides which copy exists while the user waits. Refusing matches how sync and update already behave.
- **Take the lock inside `DeviceService` or `UsbService.command`.** Every sync write would then look like a competing direct write, so the lock would need sync ownership passed down the call stack.
- **Leave profile delete one-sided.** It contradicts the acceptance criterion and leaves the same unreported disagreement for profiles, which a sync would later have to repair.

## Consequences

- The renderer-facing `storage:deletePage`, `storage:deleteProfile` and `icons:remove` channels are no longer delete paths; one channel per entity (`delete:page`, `delete:icon`, `delete:profile`) replaces them.
- `StorageService` gains `deleteIcon`, which today lives inline in the IPC handler.
- A delete attempted during a sync is refused, not performed; the UI must disable the controls so the refusal is not the normal experience.
- A partial delete is reported as a toast and the entity stays in place; retrying is just deleting again, with no retry list.
- ADR-0005's deck-first order and missing-is-success rule still stand; only its profile consequence changes.
