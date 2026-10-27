# A two-sided delete applies the deck copy first and treats absence as success

With the deck connected, deleting a page or icon sends the deck delete and then removes the library file. Any deck failure other than a missing file aborts before the library copy goes, so a retry starts from a whole state; the opposite order would leave a deck copy gone and a library copy present, which the next sync would upload again. A missing deck file, or a missing profile that would have contained the page, counts as success, because the postcondition of a delete already holds. That check lives in the main process, behind a narrow flag on the existing delete call. The error does cross the bridge, since `IpcResultErr.code` carries the firmware label (`ERR_FILE_NOT_FOUND`) and `UsbService.test.ts` asserts it, but no renderer path reads codes today and the postcondition belongs to the layer that owns the call. Checking the last inventory in the renderer was rejected: the inventory is empty until the Device view is opened, so every page would look absent and real deck files would be skipped.

## Consequences

- Most pages are deleted before they were ever synced, so the flag is the common path, not an edge case.
- Device → Files keeps its current behaviour and still reports a missing file as an error.
- Profile delete was one-sided when this ADR was written; ADR-0009 makes it two-sided with the same deck-first order. Sync still removes deck profiles with no library counterpart under issue #7.
