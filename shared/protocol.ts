// ---------------------------------------------------------------------------
// Canonical LucydDeck vendor-HID protocol contract (source of truth).
//
// Derived from the firmware wiki (USB-Protocol.md, File-Transfer-Protocol.md,
// Configuration-Schema.md, Storage-Structure.md) and the C++ headers
// (`OpCodes.hpp`, `Errors.hpp`). Both the main process and shared tooling import
// this module; it must stay free of node-hid/electron/fs imports so tests and
// the renderer can load it.
// ---------------------------------------------------------------------------

// --- Framing ---------------------------------------------------------------

/** HID report ID of the vendor interface (USBHID.h: HID_REPORT_ID_VENDOR). */
export const REPORT_ID = 0x06;

/** Application frame length: opcode (1) + sequence (2) + payload (≤60). */
export const FRAME_SIZE = 63;

/** Maximum payload bytes carried by one frame. */
export const PAYLOAD_MAX = 60;

/** M-bit: set on every device→host frame except the last of a stream. */
export const M_BIT = 0x8000;

/** 15-bit sequence/index mask (`seq & SEQ_MASK`). */
export const SEQ_MASK = 0x7fff;

// --- Timeouts / transfer limits -------------------------------------------

/** How long a host command waits for the first device frame. */
export const ACK_TIMEOUT_MS = 2000;

/** How long a partially received multi-frame response waits for its next frame. */
export const STREAM_TIMEOUT_MS = 3000;

/** Firmware internal per-transfer byte budget (4 MiB). */
export const FILE_TRANSFER_MAX_BYTES = 4 * 1024 * 1024;

/** Hard cap for a reassembled device→host response (defensive against streams). */
export const MAX_RESPONSE_BYTES = FILE_TRANSFER_MAX_BYTES;

// --- Page ids --------------------------------------------------------------

/** Firmware page ids: leading digits of `^[0-9]+\.json$`, 0..255 (unpadded). */
export const PAGE_ID_PATTERN = /^\d{1,3}$/;

/** True when `id` is a valid firmware page id (`0`..`255`). */
export function isValidPageId(id: string | number): boolean {
    const value = String(id);
    return PAGE_ID_PATTERN.test(value) && Number(value) <= 255;
}

// --- File-transfer path types ---------------------------------------------

export enum PathType {
    Page = 0x01,
    Icon = 0x02,
}

/** Wire constants for `CMD_FILE_START` path types (mirrors `PathType`). */
export const PATH_PAGE = PathType.Page;
export const PATH_ICON = PathType.Icon;

// --- Device detection ------------------------------------------------------

/** Espressif Systems USB vendor ID. */
export const DEVICE_VID = 0x303a;

/**
 * Accepted PIDs. The README table documents `0x822E` while older lifecycle
 * text/brief used `0x1001`; the matcher accepts both and logs which one hit
 * real hardware.
 */
export const DEVICE_PIDS = [0x822e, 0x1001] as const;

/** Vendor HID usage page / usage of the vendor pipe. */
export const DEVICE_USAGE_PAGE = 0xff00;
export const DEVICE_USAGE = 0x01;

// --- Opcodes ---------------------------------------------------------------

/** Host → device commands (bit 7 clear). Mirrors `enum OpCode` in OpCodes.hpp. */
export enum HostCommand {
    Ping = 0x00,
    GetDeviceInfo = 0x01,
    GetImagesList = 0x02,
    GetProfilesList = 0x03,
    ProfileCreate = 0x20,
    ProfileRename = 0x21,
    ProfileDelete = 0x22,
    FileStart = 0x30,
    FileChunk = 0x31,
    FileEnd = 0x32,
    FileCancel = 0x33,
    SetActiveProfile = 0x40,
    SetActivePage = 0x41,
}

/** Device → host responses/events (bit 7 set). Mirrors `enum OpCode`. */
export enum DeviceResponse {
    DeviceInfo = 0x80,
    ImagesList = 0x81,
    ProfilesList = 0x82,
    ActionTriggered = 0xa0,
    Error = 0xfe,
    Ack = 0xff,
}

/** True for a host-direction opcode (bit 7 clear). */
export function isHostOpcode(opcode: number): boolean {
    return (opcode & 0x80) === 0;
}

/** True for a device-direction opcode (bit 7 set). */
export function isDeviceOpcode(opcode: number): boolean {
    return (opcode & 0x80) !== 0;
}

// --- Error codes -----------------------------------------------------------

/** 1-byte `RESP_ERROR` payload. Mirrors `enum class ErrorCode` in Errors.hpp. */
export enum ErrorCode {
    Ok = 0x00,
    Sequence = 0x01,
    UnknownCommand = 0x02,
    InvalidDirection = 0x03,
    InvalidPath = 0x10,
    InvalidPageName = 0x11,
    ProfileNotFound = 0x12,
    ProfileExists = 0x13,
    Create = 0x14,
    Rename = 0x15,
    Delete = 0x16,
    TransferBusy = 0x20,
    InvalidPathType = 0x21,
    FileOpen = 0x22,
    ChunkTooLarge = 0x23,
    FileNotOpen = 0x24,
    Write = 0x25,
    NoTransfer = 0x26,
    CrcMissing = 0x27,
    Crc = 0x28,
    Finalize = 0x29,
    UnknownAction = 0x30,
    PageLoad = 0x31,
    ProfileLoad = 0x32,
}

const ERROR_CODE_NAMES: Record<number, string> = {
    [ErrorCode.Ok]: "OK",
    [ErrorCode.Sequence]: "ERR_SEQUENCE",
    [ErrorCode.UnknownCommand]: "ERR_UNKNOWN_COMMAND",
    [ErrorCode.InvalidDirection]: "ERR_INVALID_DIRECTION",
    [ErrorCode.InvalidPath]: "ERR_INVALID_PATH",
    [ErrorCode.InvalidPageName]: "ERR_INVALID_PAGE_NAME",
    [ErrorCode.ProfileNotFound]: "ERR_PROFILE_NOT_FOUND",
    [ErrorCode.ProfileExists]: "ERR_PROFILE_EXISTS",
    [ErrorCode.Create]: "ERR_CREATE",
    [ErrorCode.Rename]: "ERR_RENAME",
    [ErrorCode.Delete]: "ERR_DELETE",
    [ErrorCode.TransferBusy]: "ERR_TRANSFER_BUSY",
    [ErrorCode.InvalidPathType]: "ERR_INVALID_PATH_TYPE",
    [ErrorCode.FileOpen]: "ERR_FILE_OPEN",
    [ErrorCode.ChunkTooLarge]: "ERR_CHUNK_TOO_LARGE",
    [ErrorCode.FileNotOpen]: "ERR_FILE_NOT_OPEN",
    [ErrorCode.Write]: "ERR_WRITE",
    [ErrorCode.NoTransfer]: "ERR_NO_TRANSFER",
    [ErrorCode.CrcMissing]: "ERR_CRC_MISSING",
    [ErrorCode.Crc]: "ERR_CRC",
    [ErrorCode.Finalize]: "ERR_FINALIZE",
    [ErrorCode.UnknownAction]: "ERR_UNKNOWN_ACTION",
    [ErrorCode.PageLoad]: "ERR_PAGE_LOAD",
    [ErrorCode.ProfileLoad]: "ERR_PROFILE_LOAD",
};

/** True when `code` is one of the documented 1-byte error values. */
export function isErrorCode(code: number): code is ErrorCode {
    return Object.prototype.hasOwnProperty.call(ERROR_CODE_NAMES, code);
}

/** Human-readable firmware name for an error code, e.g. `ERR_CRC`. */
export function describeErrorCode(code: number): string {
    return ERROR_CODE_NAMES[code] ?? `ERR_UNKNOWN(0x${code.toString(16).padStart(2, "0")})`;
}

// --- Wire response payloads ------------------------------------------------

/** `RESP_DEVICE_INFO` JSON object as serialized by DeviceInfoHandler. */
export interface DeviceInfoPayload {
    fw_version: string;
    protocol_version: number | string;
    board: string;
    free_space_kb: number;
}

/** One entry of the `RESP_IMAGES_LIST` JSON array. */
export interface DeviceImageEntry {
    filename: string;
    hash: number;
}

/** One page entry of a profile in the `RESP_PROFILES_LIST` JSON array. */
export interface DevicePageEntry {
    id: number | string;
    filename: string;
    hash: number;
}

/** One profile entry of the `RESP_PROFILES_LIST` JSON array. */
export interface DeviceProfileEntry {
    name: string;
    pages: DevicePageEntry[];
}

// --- Device matching -------------------------------------------------------

/** Minimal shape of a node-hid device descriptor used by the matcher. */
export interface HidDescriptorLike {
    vendorId: number;
    productId: number;
    usagePage?: number;
    usage?: number;
    path?: string;
    product?: string;
    manufacturer?: string;
}

export interface DeviceMatch {
    matched: boolean;
    /** The PID that matched, when `matched` is true. */
    pid?: number;
    /** Diagnostic reason when `matched` is false. */
    reason?: string;
}

export interface MatchedDevice<T extends HidDescriptorLike = HidDescriptorLike> {
    device: T;
    pid: number;
}

/**
 * Match a HID descriptor against the LucydDeck vendor interface.
 *
 * Rules (wiki Home §Hardware Connection Specifications):
 * - vendorId `0x303A` (Espressif);
 * - productId in `pids` (both documented values accepted);
 * - usage page `0xFF00`, usage `0x01` when the platform reports them.
 *
 * Some backends omit `usagePage`/`usage`; when both are absent the VID/PID
 * match is accepted so the device is still usable. When either is present the
 * pair must match exactly.
 */
export function matchDevice(
    device: HidDescriptorLike,
    pids: readonly number[] = DEVICE_PIDS,
): DeviceMatch {
    if (device.vendorId !== DEVICE_VID) {
        return {
            matched: false,
            reason: `vendor 0x${device.vendorId.toString(16)} != 0x${DEVICE_VID.toString(16)}`,
        };
    }
    if (!pids.includes(device.productId)) {
        return {
            matched: false,
            reason: `pid 0x${device.productId.toString(16)} not in [${pids
                .map((pid) => `0x${pid.toString(16)}`)
                .join(", ")}]`,
        };
    }
    const hasUsage = device.usagePage !== undefined || device.usage !== undefined;
    if (hasUsage && (device.usagePage !== DEVICE_USAGE_PAGE || device.usage !== DEVICE_USAGE)) {
        return {
            matched: false,
            reason: `usagePage/usage 0x${device.usagePage?.toString(16) ?? "??"}/0x${
                device.usage?.toString(16) ?? "??"
            } != 0x${DEVICE_USAGE_PAGE.toString(16)}/0x${DEVICE_USAGE.toString(16)}`,
        };
    }
    return { matched: true, pid: device.productId };
}

/**
 * Find the first LucydDeck device in a descriptor list. Returns the matched
 * descriptor plus the PID that hit, or `null` when nothing matched. The caller
 * owns logging so the service can report the candidate PIDs it tried.
 */
export function findUsbDevice<T extends HidDescriptorLike>(
    devices: readonly T[],
    pids: readonly number[] = DEVICE_PIDS,
): MatchedDevice<T> | null {
    for (const device of devices) {
        const match = matchDevice(device, pids);
        if (match.matched && match.pid !== undefined) {
            return { device, pid: match.pid };
        }
    }
    return null;
}
