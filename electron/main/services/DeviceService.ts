import {
    DeviceResponse,
    ErrorCode,
    HostCommand,
    PAYLOAD_MAX,
    TARGET_ICON,
    TARGET_PAGE,
    isValidPageId,
    type DeviceImageEntry,
    type DeviceInfoPayload,
    type DeviceProfileEntry,
} from "@shared/protocol";
import type { DeviceInfo } from "@shared/ipc";
import type { DeckDeleteStatus } from "@shared/delete";
import { iconBaseName } from "@shared/icons";
import { crc32FromWire } from "@shared/crc32";
import { resolveEntityName } from "@shared/names";
import type { FileTransfer, UsbCommandClient } from "./FileTransfer";
import { isFirmwareError } from "./usb/FirmwareError";

export const DeviceErrorCodes = {
    InvalidName: "DEVICE_INVALID_NAME",
    InvalidPageId: "DEVICE_INVALID_PAGE_ID",
    InvalidIdentity: "DEVICE_INVALID_IDENTITY",
    BadResponse: "DEVICE_BAD_RESPONSE",
} as const;

export class DeviceError extends Error {
    readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = "DeviceError";
        this.code = code;
    }
}

export interface DeleteOptions {
    /** Treat `ERR_FILE_NOT_FOUND` as success: the file is already gone. */
    allowMissing?: boolean;
}

export interface IconUploadOptions {
    /**
     * Let an icon that already exists on the deck keep a name from before the
     * entity grammar. The firmware accepts that overwrite because it creates
     * no new name; a new legacy name is still rejected.
     */
    allowLegacyName?: boolean;
}

function textBytes(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}

function parseJson<T>(payload: Uint8Array, what: string): T {
    const text = new TextDecoder().decode(payload);
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new DeviceError(
            `Device returned malformed JSON for ${what}: ${String(error)}`,
            DeviceErrorCodes.BadResponse,
        );
    }
}

/**
 * The list payloads are the one unchecked boundary: the deck may render a hash
 * as a number or a numeric string, and an entry may carry none at all.
 */
interface WireImageEntry {
    filename: string;
    hash: unknown;
}

interface WirePageEntry {
    id: number | string;
    filename: string;
    hash: unknown;
}

interface WireProfileEntry {
    name: string;
    pages?: WirePageEntry[];
}

/**
 * Typed device operations over `UsbService.command`. Owns the wire encodings
 * for profile, page and icon commands and delegates byte transfer to
 * `FileTransfer`. Icon names are exposed/stored without the `.png` extension;
 * the wire carries the identity only and the firmware appends the extension.
 */
export class DeviceService {
    private readonly usb: UsbCommandClient;
    private readonly transfer: FileTransfer;

    constructor(usb: UsbCommandClient, transfer: FileTransfer) {
        this.usb = usb;
        this.transfer = transfer;
    }

    async getDeviceInfo(): Promise<DeviceInfo> {
        const payload = await this.usb.command(
            HostCommand.GetDeviceInfo,
            new Uint8Array(),
            DeviceResponse.DeviceInfo,
        );
        const raw = parseJson<DeviceInfoPayload>(payload, "device info");
        return {
            firmwareVersion: String(raw.fw_version ?? ""),
            protocolVersion: String(raw.protocol_version ?? ""),
            board: String(raw.board ?? ""),
            freeSpaceKb: Number(raw.free_space_kb ?? 0),
        };
    }

    async listImages(): Promise<DeviceImageEntry[]> {
        const payload = await this.usb.command(
            HostCommand.GetImagesList,
            new Uint8Array(),
            DeviceResponse.ImagesList,
        );
        const entries = parseJson<WireImageEntry[]>(payload, "images list");
        return entries.map((entry) => ({
            filename: entry.filename,
            hash: crc32FromWire(entry.hash),
        }));
    }

    async listProfiles(): Promise<DeviceProfileEntry[]> {
        const payload = await this.usb.command(
            HostCommand.GetProfilesList,
            new Uint8Array(),
            DeviceResponse.ProfilesList,
        );
        const profiles = parseJson<WireProfileEntry[]>(payload, "profiles list");
        return profiles.map((profile) => ({
            name: profile.name,
            pages: (profile.pages ?? []).map((page) => ({
                id: page.id,
                filename: page.filename,
                hash: crc32FromWire(page.hash),
            })),
        }));
    }

    async createProfile(name: string): Promise<void> {
        this.assertNewName(name);
        await this.usb.command(HostCommand.ProfileCreate, textBytes(name), DeviceResponse.Ack);
    }

    async renameProfile(oldName: string, newName: string): Promise<void> {
        this.assertExistingName(oldName);
        this.assertNewName(newName);
        await this.usb.command(
            HostCommand.ProfileRename,
            textBytes(`${oldName}:${newName}`),
            DeviceResponse.Ack,
        );
    }

    /**
     * Delete `/profiles/<name>/` on the device (`CMD_PROFILE_DELETE`). The
     * delete lookup uses the existing-name rule, so a profile stored under a
     * name from before the entity grammar is still removable.
     */
    async deleteProfile(name: string, options: DeleteOptions = {}): Promise<DeckDeleteStatus> {
        this.assertExistingName(name);
        return this.deleteIdentity(HostCommand.ProfileDelete, name, options);
    }

    async setActiveProfile(name: string): Promise<void> {
        this.assertExistingName(name);
        await this.usb.command(HostCommand.SetActiveProfile, textBytes(name), DeviceResponse.Ack);
    }

    async setActivePage(id: string | number): Promise<void> {
        const pageId = String(id);
        this.assertPageId(pageId);
        await this.usb.command(HostCommand.SetActivePage, textBytes(pageId), DeviceResponse.Ack);
    }

    /**
     * Upload a serialized page config as `<profile>/<id>`; the firmware
     * appends `.json` and commits `/profiles/<profile>/<id>.json`.
     */
    async uploadPage(
        profile: string,
        id: string | number,
        json: string | Uint8Array,
    ): Promise<void> {
        this.assertExistingName(profile);
        const pageId = String(id);
        this.assertPageId(pageId);
        const bytes = typeof json === "string" ? textBytes(json) : json;
        await this.transfer.upload(TARGET_PAGE, `${profile}/${pageId}`, bytes);
    }

    /**
     * Upload a PNG icon as `<name>`; the firmware appends `.png` and commits
     * `/icons/<name>.png`. `name` may be given with or without the extension.
     */
    async uploadIcon(
        name: string,
        pngBytes: Uint8Array,
        options: IconUploadOptions = {},
    ): Promise<void> {
        const base = iconBaseName(name);
        if (options.allowLegacyName === true) {
            this.assertExistingName(base);
        } else {
            this.assertNewName(base);
        }
        await this.transfer.upload(TARGET_ICON, base, pngBytes);
    }

    /** Delete `/profiles/<profile>/<id>.json` on the device (`CMD_PAGE_DELETE`). */
    async deletePage(
        profile: string,
        id: string | number,
        options: DeleteOptions = {},
    ): Promise<DeckDeleteStatus> {
        this.assertExistingName(profile);
        const pageId = String(id);
        this.assertPageId(pageId);
        return this.deleteIdentity(HostCommand.PageDelete, `${profile}/${pageId}`, options);
    }

    /**
     * Delete `/icons/<name>.png` on the device (`CMD_ICON_DELETE`). `name` may
     * be given with or without the extension.
     */
    async deleteIcon(name: string, options: DeleteOptions = {}): Promise<DeckDeleteStatus> {
        const base = iconBaseName(name);
        this.assertExistingName(base);
        return this.deleteIdentity(HostCommand.IconDelete, base, options);
    }

    /** One identity string, no target byte: it must fit a single frame. */
    private async deleteIdentity(
        opcode: HostCommand.PageDelete | HostCommand.IconDelete | HostCommand.ProfileDelete,
        identity: string,
        options: DeleteOptions,
    ): Promise<DeckDeleteStatus> {
        const identityBytes = textBytes(identity);
        if (identity === "" || identityBytes.length > PAYLOAD_MAX) {
            throw new DeviceError(
                `Identity too long for one frame: "${identity}" (${identityBytes.length} > ${PAYLOAD_MAX} bytes)`,
                DeviceErrorCodes.InvalidIdentity,
            );
        }
        try {
            await this.usb.command(opcode, identityBytes, DeviceResponse.Ack);
            return "deleted";
        } catch (error) {
            // The postcondition of a delete is that the file is gone, and it
            // already holds when the deck answers that it never had it. A page
            // in a profile the deck never received is the common case: the
            // firmware reports the missing profile before it looks for the file.
            if (
                options.allowMissing === true &&
                (isFirmwareError(error, ErrorCode.FileNotFound) ||
                    isFirmwareError(error, ErrorCode.ProfileNotFound))
            ) {
                return "missing";
            }
            throw error;
        }
    }

    /**
     * The wire layer never rewrites a name: sanitising belongs to the storage
     * boundary, and sending a different name than the caller asked for would
     * hide a mistake. A new name that would sanitise to something else is
     * therefore refused rather than silently changed.
     */
    private assertNewName(name: string): void {
        const resolved = resolveEntityName(name, "new");
        if (!resolved.ok || resolved.name !== name) {
            throw new DeviceError(
                `Invalid device name: "${name}" (the deck only accepts 1-64 letters, digits, spaces, "-" and "_")`,
                DeviceErrorCodes.InvalidName,
            );
        }
    }

    /** A lookup or delete addresses something already on the deck. */
    private assertExistingName(name: string): void {
        if (!resolveEntityName(name, "existing").ok) {
            throw new DeviceError(`Invalid device name: "${name}"`, DeviceErrorCodes.InvalidName);
        }
    }

    private assertPageId(id: string): void {
        if (!isValidPageId(id)) {
            throw new DeviceError(
                `Invalid page id: "${id}" (expected 0..255)`,
                DeviceErrorCodes.InvalidPageId,
            );
        }
    }
}
