# Reference warnings are scanned in the main process

Deleting an icon or a page from the library leaves keys that point at nothing, and a page referencing an icon that is on neither side is what hung the deck at boot once. The renderer only holds the active profile's pages, while an icon can be referenced from any profile, so the scan runs in the main process behind one IPC call that walks every local page and returns where an icon, page or profile is referenced. The delete dialogs stay one step and advisory: the existing confirm gains a sentence naming up to three referencing locations, and deleting is still allowed. A failed scan shows no reference sentence rather than blocking the delete. A scan that skips an unreadable or invalid page returns the hits it found with a `partial` flag, and the dialog says the list may be incomplete.

## Consequences

- The delete dialogs wait on one scan round trip. The warning is informational, so a scan error must not stop the delete.
- Profile delete uses the same scan for `PROFILE:` steps.
- The Review banner for a missing icon stays advisory. Making a plan refuse to upload a page whose icon is on neither side belongs to the planner and to lucyd-dev/LucydDeck-firmware#12, not to this dialog.
