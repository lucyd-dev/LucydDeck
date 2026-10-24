import {
    DeviceResponse,
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
import { validateName } from "./StorageService";
import type { FileTransfer, UsbCommandClient } from "./FileTransfer";

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

export type NameValidator = (name: string) => boolean;

const PNG_EXTENSION = /\.png$/i;

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
 * Typed device operations over `UsbService.command`. Owns the wire encodings
 * for profile, page and icon commands and delegates byte transfer to
 * `FileTransfer`. Icon names are exposed/stored without the `.png` extension;
 * the wire carries the identity only and the firmware appends the extension.
 */
export class DeviceService {
    private readonly usb: UsbCommandClient;
    private readonly transfer: FileTransfer;
    private readonly validator: NameValidator;

    constructor(
        usb: UsbCommandClient,
        transfer: FileTransfer,
        validator: NameValidator = validateName,
    ) {
        this.usb = usb;
        this.transfer = transfer;
        this.validator = validator;
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
        return parseJson<DeviceImageEntry[]>(payload, "images list");
    }

    async listProfiles(): Promise<DeviceProfileEntry[]> {
        const payload = await this.usb.command(
            HostCommand.GetProfilesList,
            new Uint8Array(),
            DeviceResponse.ProfilesList,
        );
        return parseJson<DeviceProfileEntry[]>(payload, "profiles list");
    }

    async createProfile(name: string): Promise<void> {
        this.assertName(name);
        await this.usb.command(HostCommand.ProfileCreate, textBytes(name), DeviceResponse.Ack);
    }

    async renameProfile(oldName: string, newName: string): Promise<void> {
        this.assertName(oldName);
        this.assertName(newName);
        await this.usb.command(
            HostCommand.ProfileRename,
            textBytes(`${oldName}:${newName}`),
            DeviceResponse.Ack,
        );
    }

    async deleteProfile(name: string): Promise<void> {
        this.assertName(name);
        await this.usb.command(HostCommand.ProfileDelete, textBytes(name), DeviceResponse.Ack);
    }

    async setActiveProfile(name: string): Promise<void> {
        this.assertName(name);
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
        this.assertName(profile);
        const pageId = String(id);
        this.assertPageId(pageId);
        const bytes = typeof json === "string" ? textBytes(json) : json;
        await this.transfer.upload(TARGET_PAGE, `${profile}/${pageId}`, bytes);
    }

    /**
     * Upload a PNG icon as `<name>`; the firmware appends `.png` and commits
     * `/icons/<name>.png`. `name` may be given with or without the extension.
     */
    async uploadIcon(name: string, pngBytes: Uint8Array): Promise<void> {
        const base = name.replace(PNG_EXTENSION, "");
        this.assertName(base);
        await this.transfer.upload(TARGET_ICON, base, pngBytes);
    }

    /** Delete `/profiles/<profile>/<id>.json` on the device (`CMD_PAGE_DELETE`). */
    async deletePage(profile: string, id: string | number): Promise<void> {
        this.assertName(profile);
        const pageId = String(id);
        this.assertPageId(pageId);
        await this.deleteIdentity(HostCommand.PageDelete, `${profile}/${pageId}`);
    }

    /**
     * Delete `/icons/<name>.png` on the device (`CMD_ICON_DELETE`). `name` may
     * be given with or without the extension.
     */
    async deleteIcon(name: string): Promise<void> {
        const base = name.replace(PNG_EXTENSION, "");
        this.assertName(base);
        await this.deleteIdentity(HostCommand.IconDelete, base);
    }

    /** One identity string, no target byte: it must fit a single frame. */
    private async deleteIdentity(
        opcode: HostCommand.PageDelete | HostCommand.IconDelete,
        identity: string,
    ): Promise<void> {
        const identityBytes = textBytes(identity);
        if (identity === "" || identityBytes.length > PAYLOAD_MAX) {
            throw new DeviceError(
                `Identity too long for one frame: "${identity}" (${identityBytes.length} > ${PAYLOAD_MAX} bytes)`,
                DeviceErrorCodes.InvalidIdentity,
            );
        }
        await this.usb.command(opcode, identityBytes, DeviceResponse.Ack);
    }

    private assertName(name: string): void {
        if (!this.validator(name)) {
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
