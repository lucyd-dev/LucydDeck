// ---------------------------------------------------------------------------
// Firmware error predicates.
//
// `UsbService` rejects a command with a `UsbError` that keeps the deck's
// `RESP_ERROR` byte in `firmwareCode`, next to the host-side label in `code`.
// Callers that care about a specific rejection use this instead of matching the
// message text.
// ---------------------------------------------------------------------------

import { ErrorCode } from "@shared/protocol";

/** True when the deck rejected a command with the given firmware error code. */
export function isFirmwareError(error: unknown, code: ErrorCode): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "firmwareCode" in error &&
        (error as { firmwareCode?: unknown }).firmwareCode === code
    );
}
