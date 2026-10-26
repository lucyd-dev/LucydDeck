// ---------------------------------------------------------------------------
// Firmware flashing contract shared by the main process and the renderer.
//
// The deck's partition table (`max_app_8MB`) has one factory app slot. The
// updater writes only that slot, at its fixed address, and refuses anything
// that falls outside it before the bootloader handoff.
// ---------------------------------------------------------------------------

/** Fixed address of `app0` in the `max_app_8MB` partition layout. */
export const APP_SLOT_ADDRESS = 0x10000;

/** `app0` size: `0x7E0000` bytes, exactly 8064 KiB. */
export const APP_SLOT_SIZE = 0x7e0000;

export type FlashSizeRefusal = "empty" | "size";

export type FlashSizeCheck =
    { ok: true } | { ok: false; reason: FlashSizeRefusal; message: string };

/**
 * Enforce the app-slot size bound before anything reaches the deck. An image of
 * exactly `APP_SLOT_SIZE` bytes is acceptable; one byte more is refused.
 *
 * Address, layout and chip come from the release manifest, so their checks
 * belong to the release updater; a local file carries no manifest to compare.
 */
export function validateFlashSize(size: number): FlashSizeCheck {
    if (!Number.isFinite(size) || size <= 0) {
        return {
            ok: false,
            reason: "empty",
            message: "That image is empty. Choose the app image built for this deck.",
        };
    }
    if (size > APP_SLOT_SIZE) {
        return {
            ok: false,
            reason: "size",
            message:
                "That image is larger than this deck can accept. Choose a firmware image built for this deck.",
        };
    }
    return { ok: true };
}

// --- State -----------------------------------------------------------------

export type FirmwarePhase =
    /** Nothing selected. */
    | "idle"
    /** A local image passed the app-slot check and waits for confirmation. */
    | "ready"
    /** The handoff command was sent; the HID interface is going away. */
    | "handoff"
    /** Waiting for the ROM loader's serial port on the recorded USB identity. */
    | "locating"
    /** esptool-js is writing the app image. */
    | "writing"
    /** The write finished; waiting for the deck's HID interface to return. */
    | "returning"
    /** The deck returned and the installed version was read. */
    | "done"
    /** The flash stopped with a message and a next step. */
    | "error";

export interface FirmwareImageInfo {
    path: string;
    name: string;
    size: number;
    /** Fixed app-slot address used by the local path. */
    address: number;
}

export const FirmwareErrorCodes = {
    Busy: "FIRMWARE_BUSY",
    NotConnected: "FIRMWARE_NOT_CONNECTED",
    NoImage: "FIRMWARE_NO_IMAGE",
    ImageRejected: "FIRMWARE_IMAGE_REJECTED",
    Handoff: "FIRMWARE_HANDOFF_FAILED",
    FirmwareTooOld: "FIRMWARE_TOO_OLD",
    PortNotFound: "FIRMWARE_PORT_NOT_FOUND",
    PortPermission: "FIRMWARE_PORT_PERMISSION",
    PortBusy: "FIRMWARE_PORT_BUSY",
    Loader: "FIRMWARE_LOADER_FAILED",
    Write: "FIRMWARE_WRITE_FAILED",
    NoReturn: "FIRMWARE_NO_RETURN",
    NoVersion: "FIRMWARE_NO_VERSION",
    Failed: "FIRMWARE_FAILED",
} as const;

export type FirmwareErrorCode = (typeof FirmwareErrorCodes)[keyof typeof FirmwareErrorCodes];

/** Phases in which a flash owns the deck and the UI must not start another. */
export function isFirmwareBusy(phase: FirmwarePhase): boolean {
    return (
        phase === "handoff" || phase === "locating" || phase === "writing" || phase === "returning"
    );
}

export interface FirmwareErrorInfo {
    /** Stable machine-readable reason. */
    code: FirmwareErrorCode;
    /** One sentence plus a next step, for the Firmware section. */
    message: string;
}

export interface FirmwareState {
    phase: FirmwarePhase;
    /** Deck firmware version last reported by the deck. */
    installedVersion: string | null;
    /** Deck board name last reported by the deck. */
    board: string | null;
    /** Local image selected for an Advanced flash, if any. */
    image: FirmwareImageInfo | null;
    error: FirmwareErrorInfo | null;
}

export function idleFirmwareState(): FirmwareState {
    return {
        phase: "idle",
        installedVersion: null,
        board: null,
        image: null,
        error: null,
    };
}

// --- Progress --------------------------------------------------------------

export type FlashPhase = "handoff" | "locating" | "writing" | "returning" | "done";

export interface FlashProgressPayload {
    /** 0-100. A sweeping stage without a measurable percentage stays at 0. */
    percent: number;
    /** Bytes written and total image bytes while the write runs. */
    writtenBytes?: number;
    totalBytes?: number;
}

export const FLASH_STAGE_COPY: Record<FlashPhase, string> = {
    handoff: "Asking the deck to enter bootloader mode…",
    locating: "Waiting for the deck's bootloader mode…",
    writing: "Writing the firmware. Do not unplug the deck.",
    returning: "The write is finished. Waiting for the deck to come back…",
    done: "Firmware written. The deck is back.",
};

// --- IPC request -----------------------------------------------------------

export interface FlashLocalRequest {
    /**
     * Absolute `.bin` path. Omitted opens the native picker and only validates
     * the image; the renderer confirms the preview, then sends the path with
     * `confirmed: true` to start the flash.
     */
    path?: string;
    /** Start the flash for `path` after the user confirmed the preview. */
    confirmed?: boolean;
}
