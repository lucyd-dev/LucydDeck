import type { PageConfig, PageMeta, ProfileMeta } from "./types";

// ---------------------------------------------------------------------------
// Result envelope. Every IPC handler resolves to exactly one of these shapes.
// Handlers must never throw across the bridge; errors are serialized as
// `{ ok: false, error }`.
// ---------------------------------------------------------------------------

export interface IpcResultOk<T> {
    ok: true;
    data: T;
}

export interface IpcResultErr {
    ok: false;
    error: string;
}

export type IpcResponse<T> = IpcResultOk<T> | IpcResultErr;

// ---------------------------------------------------------------------------
// Channel names (single source of truth).
// Renderer never uses raw ipcRenderer strings: it imports these constants and
// goes through `window.lucyd`. Tests assert global uniqueness.
// ---------------------------------------------------------------------------

export const channels = {
    storage: {
        listProfiles: "storage:listProfiles",
        createProfile: "storage:createProfile",
        renameProfile: "storage:renameProfile",
        deleteProfile: "storage:deleteProfile",
        listPages: "storage:listPages",
        loadPage: "storage:loadPage",
        savePage: "storage:savePage",
        exportProfile: "storage:exportProfile",
        importProfile: "storage:importProfile",
    },
    icons: {
        list: "icons:list",
        import: "icons:import",
        remove: "icons:remove",
    },
    usb: {
        status: "usb:status",
        connect: "usb:connect",
        disconnect: "usb:disconnect",
        deviceInfo: "usb:deviceInfo",
    },
    plugins: {
        list: "plugins:list",
        setEnabled: "plugins:setEnabled",
        remove: "plugins:remove",
    },
    updater: {
        state: "updater:state",
        check: "updater:check",
    },
    firmware: {
        getState: "firmware:getState",
        update: "firmware:update",
    },
} as const;

/** Main-process to renderer push events (via ipcRenderer.send + contextBridge). */
export const eventChannels = {
    usb: "usb:event",
    toast: "app:toast",
    syncProgress: "sync:progress",
    plugin: "plugin:event",
    firmwareState: "firmware:state",
    flashProgress: "flash:progress",
} as const;

// ---------------------------------------------------------------------------
// Request / response payload types, keyed by channel name.
// Add a channel, add its request/response here — `window.lucyd` stays typed.
// ---------------------------------------------------------------------------

export interface ProfileNameRequest {
    name: string;
}

export interface RenameProfileRequest {
    oldName: string;
    newName: string;
}

export interface PageRefRequest {
    profile: string;
    id: string;
}

export interface SavePageRequest {
    profile: string;
    id: string;
    page: PageConfig;
}

export interface ExportProfileRequest {
    name: string;
}

export interface IconRemoveRequest {
    name: string;
}

export interface IconsImportRequest {
    paths: string[];
}

export interface PluginSetEnabledRequest {
    id: string;
    enabled: boolean;
}

export interface PluginRemoveRequest {
    id: string;
}

export interface RequestMap {
    // storage (implemented in Step 1)
    [channels.storage.listProfiles]: undefined;
    [channels.storage.createProfile]: ProfileNameRequest;
    [channels.storage.renameProfile]: RenameProfileRequest;
    [channels.storage.deleteProfile]: ProfileNameRequest;
    [channels.storage.listPages]: ProfileNameRequest;
    [channels.storage.loadPage]: PageRefRequest;
    [channels.storage.savePage]: SavePageRequest;
    [channels.storage.exportProfile]: ExportProfileRequest;
    [channels.storage.importProfile]: undefined;

    // icons (stub — Step 3+ uses it with the sharp pipeline)
    [channels.icons.list]: undefined;
    [channels.icons.import]: IconsImportRequest;
    [channels.icons.remove]: IconRemoveRequest;

    // usb (stub — Step 2 implements the HID engine)
    [channels.usb.status]: undefined;
    [channels.usb.connect]: undefined;
    [channels.usb.disconnect]: undefined;
    [channels.usb.deviceInfo]: undefined;

    // plugins (stub — Step 4)
    [channels.plugins.list]: undefined;
    [channels.plugins.setEnabled]: PluginSetEnabledRequest;
    [channels.plugins.remove]: PluginRemoveRequest;

    // updater (stub — Step 5)
    [channels.updater.state]: undefined;
    [channels.updater.check]: undefined;

    // firmware (stub — Step 5)
    [channels.firmware.getState]: undefined;
    [channels.firmware.update]: undefined;
}

export interface ResponseMap {
    // storage
    [channels.storage.listProfiles]: IpcResponse<ProfileMeta[]>;
    [channels.storage.createProfile]: IpcResponse<ProfileMeta>;
    [channels.storage.renameProfile]: IpcResponse<ProfileMeta>;
    [channels.storage.deleteProfile]: IpcResponse<void>;
    [channels.storage.listPages]: IpcResponse<PageMeta[]>;
    [channels.storage.loadPage]: IpcResponse<PageConfig>;
    [channels.storage.savePage]: IpcResponse<void>;
    [channels.storage.exportProfile]: IpcResponse<{ path: string } | null>;
    [channels.storage.importProfile]: IpcResponse<ProfileMeta | null>;

    // icons
    [channels.icons.list]: IpcResponse<IconMeta[]>;
    [channels.icons.import]: IpcResponse<IconMeta[]>;
    [channels.icons.remove]: IpcResponse<void>;

    // usb
    [channels.usb.status]: IpcResponse<DeviceStatus>;
    [channels.usb.connect]: IpcResponse<void>;
    [channels.usb.disconnect]: IpcResponse<void>;
    [channels.usb.deviceInfo]: IpcResponse<DeviceInfo | null>;

    // plugins
    [channels.plugins.list]: IpcResponse<PluginMeta[]>;
    [channels.plugins.setEnabled]: IpcResponse<void>;
    [channels.plugins.remove]: IpcResponse<void>;

    // updater
    [channels.updater.state]: IpcResponse<UpdaterState>;
    [channels.updater.check]: IpcResponse<UpdaterState>;

    // firmware
    [channels.firmware.getState]: IpcResponse<FirmwareState>;
    [channels.firmware.update]: IpcResponse<FirmwareState>;
}

// ---------------------------------------------------------------------------
// Event payload types, keyed by event channel name.
// ---------------------------------------------------------------------------

export enum DeviceState {
    Disconnected = "disconnected",
    Connecting = "connecting",
    Connected = "connected",
    Error = "error",
}

export interface DeviceStatus {
    state: DeviceState;
    label: string;
}

export interface DeviceInfo {
    firmwareVersion: string;
    protocolVersion: string;
    board: string;
    freeSpaceKb: number;
}

export interface IconMeta {
    name: string;
    hash: string;
}

export interface PluginMeta {
    id: string;
    name: string;
    enabled: boolean;
}

export interface UpdaterState {
    state: "idle" | "checking" | "available" | "downloading" | "error";
    version?: string;
}

export interface FirmwareState {
    state: "idle" | "flashing" | "error";
    version?: string;
}

export interface ToastPayload {
    level: "info" | "success" | "warning" | "error";
    message: string;
}

export interface SyncProgressPayload {
    phase: string;
    percent: number;
}

export interface PluginEventPayload {
    pluginId: string;
    event: string;
    payload?: unknown;
}

export interface FirmwareStatePayload {
    state: FirmwareState["state"];
    version?: string;
}

export interface FlashProgressPayload {
    phase: string;
    percent: number;
}

export interface EventPayloadMap {
    [eventChannels.usb]: DeviceStatus;
    [eventChannels.toast]: ToastPayload;
    [eventChannels.syncProgress]: SyncProgressPayload;
    [eventChannels.plugin]: PluginEventPayload;
    [eventChannels.firmwareState]: FirmwareStatePayload;
    [eventChannels.flashProgress]: FlashProgressPayload;
}

// ---------------------------------------------------------------------------
// Typed bridge surface exposed as `window.lucyd` (see electron/preload.ts).
// ---------------------------------------------------------------------------

export type IpcChannel = keyof RequestMap;
export type EventChannel = keyof EventPayloadMap;

export type RequestFor<C extends IpcChannel> = RequestMap[C];
export type ResponseFor<C extends IpcChannel> = ResponseMap[C];
export type EventPayloadFor<E extends EventChannel> = EventPayloadMap[E];

export interface LucydApi {
    invoke<C extends IpcChannel>(channel: C, payload: RequestFor<C>): Promise<ResponseFor<C>>;
    on<E extends EventChannel>(channel: E, handler: (payload: EventPayloadFor<E>) => void): number;
    off<E extends EventChannel>(channel: E, id: number): void;
}

/** All request channel names, for the uniqueness test and debug tooling. */
export function listChannels(): readonly string[] {
    return Object.values(channels).flatMap((group) => Object.values(group));
}

/** All event channel names, for the uniqueness test and debug tooling. */
export function listEventChannels(): readonly string[] {
    return Object.values(eventChannels);
}
