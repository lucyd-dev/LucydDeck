import {
    DeviceResponse,
    HostCommand,
    PATH_ICON,
    PATH_PAGE,
    PAYLOAD_MAX,
    PathType,
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
 * for profile/page commands and delegates byte transfer to `FileTransfer`.
 * Icon names are exposed/stored without the `.png` extension; the wire path
 * carries the extension because the firmware target is `/icons/<path>`.
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

    /** Upload a serialized page config to `/profiles/<profile>/<id>.json`. */
    async uploadPage(
        profile: string,
        id: string | number,
        json: string | Uint8Array,
    ): Promise<void> {
        this.assertName(profile);
        const pageId = String(id);
        this.assertPageId(pageId);
        const bytes = typeof json === "string" ? textBytes(json) : json;
        await this.transfer.upload(PATH_PAGE, `${profile}/${pageId}.json`, bytes);
    }

    /**
     * Upload a PNG icon to `/icons/<name>.png`. `name` may be given with or
     * without the extension; the stored/returned name is the base name.
     */
    async uploadIcon(name: string, pngBytes: Uint8Array): Promise<void> {
        const base = name.replace(PNG_EXTENSION, "");
        this.assertName(base);
        await this.transfer.upload(PATH_ICON, `${base}.png`, pngBytes);
    }

    /**
     * Delete one file (`CMD_FILE_DELETE = 0x34`, protocol 2+). Payload is
     * `[pathType][path]`, same path grammar as `CMD_FILE_START`.
     */
    async deleteFile(pathType: PathType, path: string): Promise<void> {
        const pathBytes = textBytes(path);
        if (path === "" || pathBytes.length + 1 > PAYLOAD_MAX) {
            throw new DeviceError(`Invalid file path: "${path}"`, DeviceErrorCodes.InvalidName);
        }
        const payload = new Uint8Array(pathBytes.length + 1);
        payload[0] = pathType;
        payload.set(pathBytes, 1);
        await this.usb.command(HostCommand.FileDelete, payload, DeviceResponse.Ack);
    }

    /** Delete `/profiles/<profile>/<id>.json` on the device. */
    async deletePage(profile: string, id: string | number): Promise<void> {
        this.assertName(profile);
        const pageId = String(id);
        this.assertPageId(pageId);
        await this.deleteFile(PathType.Page, `${profile}/${pageId}.json`);
    }

    /** Delete `/icons/<name>.png` on the device (base name, with or without extension). */
    async deleteIcon(name: string): Promise<void> {
        const base = name.replace(PNG_EXTENSION, "");
        this.assertName(base);
        await this.deleteFile(PathType.Icon, `${base}.png`);
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
