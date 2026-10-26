import type { PageConfig, PageMeta, ProfileMeta } from "./types";
import type { DeviceImageEntry, DeviceProfileEntry } from "./protocol";
import type { AppSettings } from "./settings";
import type {
    FirmwareCheckRequest,
    FlashLocalRequest,
    FlashProgressPayload,
    FirmwareState,
} from "./firmware";
import type { DiffPlan, SyncResult } from "./sync";
import type {
    PluginCommand,
    PluginConfigField,
    PluginConfigValues,
    PluginManifest,
    PluginStatus,
} from "./plugins";

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
    /** Optional stable machine-readable code (e.g. `USB_TIMEOUT`, `ERR_CRC`). */
    code?: string;
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
        deletePage: "storage:deletePage",
        exportProfile: "storage:exportProfile",
        importProfile: "storage:importProfile",
        getDefaultProfile: "storage:getDefaultProfile",
        setDefaultProfile: "storage:setDefaultProfile",
        scanReferences: "storage:scanReferences",
    },
    icons: {
        list: "icons:list",
        import: "icons:import",
        importData: "icons:importData",
        remove: "icons:remove",
        preview: "icons:preview",
    },
    sync: {
        reconcile: "sync:reconcile",
        execute: "sync:execute",
    },
    usb: {
        status: "usb:status",
        connect: "usb:connect",
        disconnect: "usb:disconnect",
        deviceInfo: "usb:deviceInfo",
        listImages: "usb:listImages",
        listProfiles: "usb:listProfiles",
        createProfile: "usb:createProfile",
        renameProfile: "usb:renameProfile",
        deleteProfile: "usb:deleteProfile",
        setActiveProfile: "usb:setActiveProfile",
        setActivePage: "usb:setActivePage",
        uploadPage: "usb:uploadPage",
        uploadIcon: "usb:uploadIcon",
        deleteFile: "usb:deleteFile",
    },
    settings: {
        get: "settings:get",
        set: "settings:set",
        revealDataFolder: "settings:revealDataFolder",
        openLogsFolder: "settings:openLogsFolder",
    },
    plugins: {
        list: "plugins:list",
        inspect: "plugins:inspect",
        install: "plugins:install",
        setEnabled: "plugins:setEnabled",
        restart: "plugins:restart",
        remove: "plugins:remove",
        getConfig: "plugins:getConfig",
        setConfig: "plugins:setConfig",
        invoke: "plugins:invoke",
    },
    updater: {
        state: "updater:state",
        check: "updater:check",
    },
    firmware: {
        getState: "firmware:getState",
        check: "firmware:check",
        update: "firmware:update",
        flashLocal: "firmware:flashLocal",
        retry: "firmware:retry",
        cancel: "firmware:cancel",
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

export interface SetDefaultProfileRequest {
    /** `null` clears the persisted default. */
    name: string | null;
}

export interface IconRemoveRequest {
    name: string;
}

export interface IconsImportRequest {
    /** Absolute source paths; when omitted the main process shows a picker. */
    paths?: string[];
}

/** Import a cropped/adjusted image supplied as a data URL from the renderer. */
export interface IconImportDataRequest {
    /** Desired icon base name (slugified main-side). */
    name: string;
    /** `data:image/png;base64,...` payload from the canvas crop tool. */
    dataUrl: string;
}

export interface IconPreviewRequest {
    name: string;
}

export interface SyncReconcileRequest {
    /** Profile the user wants active after sync (optional). */
    activeProfile?: string;
}

export interface SyncExecuteRequest {
    plan: DiffPlan;
    /**
     * Run the plan's device removals. Only a sync the user starts sets this;
     * an autosync pass omits it so a background run cannot wipe deck state.
     */
    allowRemovals?: boolean;
}

export interface UsbSetActivePageRequest {
    id: string;
}

export interface UsbUploadPageRequest {
    profile: string;
    id: string;
}

export interface UsbUploadIconRequest {
    name: string;
}

/** Delete one device page or icon by identity (`0x23` / `0x24`). */
export type UsbDeleteFileRequest = (
    { kind: "page"; profile: string; id: string } | { kind: "icon"; name: string }
) & {
    /** Treat a missing deck file as success; defaults to false. */
    allowMissing?: boolean;
};

/** One page in the library that references a page, icon or profile. */
export interface ReferenceHit {
    profile: string;
    pageId: string;
}

export type ReferenceKind = "icon" | "page" | "profile" | "plugin";

export type ReferenceQuery =
    | { kind: "icon"; name: string }
    | { kind: "page"; profile: string; id: string }
    | { kind: "profile"; name: string }
    | { kind: "plugin"; handle: string };

export interface ReferenceScanResult {
    hits: ReferenceHit[];
    /** True when an unreadable or invalid page was skipped. */
    partial: boolean;
}

export interface SettingsSetRequest {
    settings: Partial<AppSettings>;
}

/** Everything the renderer needs to paint Settings and apply the theme. */
export interface SettingsSnapshot {
    settings: AppSettings;
    dataDir: string;
    logsDir: string;
    version: string;
    repository: string;
    license: string;
}

export interface PluginSetEnabledRequest {
    handle: string;
    enabled: boolean;
}

export interface PluginRemoveRequest {
    handle: string;
}

export interface PluginInspectRequest {
    /** Omitted opens the native folder picker. */
    path?: string;
}

export interface PluginInstallRequest {
    path: string;
    replace?: boolean;
}

export interface PluginHandleRequest {
    handle: string;
}

export interface PluginSetConfigRequest {
    handle: string;
    values: PluginConfigValues;
}

export interface PluginInvokeRequest {
    handle: string;
    command: string;
}

export interface PluginConfigSnapshot {
    handle: string;
    fields: PluginConfigField[];
    values: PluginConfigValues;
}

/** What the install confirmation shows before anything is copied. */
export interface PluginInspectResult {
    path: string;
    manifest: PluginManifest | null;
    valid: boolean;
    error: string | null;
    installedVersion: string | null;
    iconDataUrl: string | null;
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
    [channels.storage.deletePage]: PageRefRequest;
    [channels.storage.exportProfile]: ExportProfileRequest;
    [channels.storage.importProfile]: undefined;
    [channels.storage.getDefaultProfile]: undefined;
    [channels.storage.setDefaultProfile]: SetDefaultProfileRequest;
    [channels.storage.scanReferences]: ReferenceQuery;

    // icons (stub — Step 3+ uses it with the sharp pipeline)
    [channels.icons.list]: undefined;
    [channels.icons.import]: IconsImportRequest;
    [channels.icons.importData]: IconImportDataRequest;
    [channels.icons.remove]: IconRemoveRequest;
    [channels.icons.preview]: IconPreviewRequest;

    // sync (Step 3 delta-sync engine)
    [channels.sync.reconcile]: SyncReconcileRequest;
    [channels.sync.execute]: SyncExecuteRequest;

    // usb (Step 2 implements the HID engine)
    [channels.usb.status]: undefined;
    [channels.usb.connect]: undefined;
    [channels.usb.disconnect]: undefined;
    [channels.usb.deviceInfo]: undefined;
    [channels.usb.listImages]: undefined;
    [channels.usb.listProfiles]: undefined;
    [channels.usb.createProfile]: ProfileNameRequest;
    [channels.usb.renameProfile]: RenameProfileRequest;
    [channels.usb.deleteProfile]: ProfileNameRequest;
    [channels.usb.setActiveProfile]: ProfileNameRequest;
    [channels.usb.setActivePage]: UsbSetActivePageRequest;
    [channels.usb.uploadPage]: UsbUploadPageRequest;
    [channels.usb.uploadIcon]: UsbUploadIconRequest;
    [channels.usb.deleteFile]: UsbDeleteFileRequest;

    // settings
    [channels.settings.get]: undefined;
    [channels.settings.set]: SettingsSetRequest;
    [channels.settings.revealDataFolder]: undefined;
    [channels.settings.openLogsFolder]: undefined;

    // plugins
    [channels.plugins.list]: undefined;
    [channels.plugins.inspect]: PluginInspectRequest;
    [channels.plugins.install]: PluginInstallRequest;
    [channels.plugins.setEnabled]: PluginSetEnabledRequest;
    [channels.plugins.restart]: PluginHandleRequest;
    [channels.plugins.remove]: PluginRemoveRequest;
    [channels.plugins.getConfig]: PluginHandleRequest;
    [channels.plugins.setConfig]: PluginSetConfigRequest;
    [channels.plugins.invoke]: PluginInvokeRequest;

    // updater (stub — Step 5)
    [channels.updater.state]: undefined;
    [channels.updater.check]: undefined;

    // firmware (release update and a local image)
    [channels.firmware.getState]: undefined;
    [channels.firmware.check]: FirmwareCheckRequest;
    [channels.firmware.update]: undefined;
    [channels.firmware.flashLocal]: FlashLocalRequest;
    [channels.firmware.retry]: undefined;
    [channels.firmware.cancel]: undefined;
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
    [channels.storage.deletePage]: IpcResponse<void>;
    [channels.storage.exportProfile]: IpcResponse<{ path: string } | null>;
    [channels.storage.importProfile]: IpcResponse<ProfileMeta | null>;
    [channels.storage.getDefaultProfile]: IpcResponse<string | null>;
    [channels.storage.setDefaultProfile]: IpcResponse<void>;
    [channels.storage.scanReferences]: IpcResponse<ReferenceScanResult>;

    // icons
    [channels.icons.list]: IpcResponse<IconMeta[]>;
    [channels.icons.import]: IpcResponse<IconMeta[]>;
    [channels.icons.importData]: IpcResponse<IconMeta>;
    [channels.icons.remove]: IpcResponse<void>;
    [channels.icons.preview]: IpcResponse<IconPreview | null>;

    // sync
    [channels.sync.reconcile]: IpcResponse<DiffPlan>;
    [channels.sync.execute]: IpcResponse<SyncResult>;

    // usb
    [channels.usb.status]: IpcResponse<DeviceStatus>;
    [channels.usb.connect]: IpcResponse<void>;
    [channels.usb.disconnect]: IpcResponse<void>;
    [channels.usb.deviceInfo]: IpcResponse<DeviceInfo | null>;
    [channels.usb.listImages]: IpcResponse<DeviceImageEntry[]>;
    [channels.usb.listProfiles]: IpcResponse<DeviceProfileEntry[]>;
    [channels.usb.createProfile]: IpcResponse<void>;
    [channels.usb.renameProfile]: IpcResponse<void>;
    [channels.usb.deleteProfile]: IpcResponse<void>;
    [channels.usb.setActiveProfile]: IpcResponse<void>;
    [channels.usb.setActivePage]: IpcResponse<void>;
    [channels.usb.uploadPage]: IpcResponse<void>;
    [channels.usb.uploadIcon]: IpcResponse<void>;
    [channels.usb.deleteFile]: IpcResponse<void>;

    // settings
    [channels.settings.get]: IpcResponse<SettingsSnapshot>;
    [channels.settings.set]: IpcResponse<SettingsSnapshot>;
    [channels.settings.revealDataFolder]: IpcResponse<void>;
    [channels.settings.openLogsFolder]: IpcResponse<void>;

    // plugins
    [channels.plugins.list]: IpcResponse<PluginMeta[]>;
    [channels.plugins.inspect]: IpcResponse<PluginInspectResult | null>;
    [channels.plugins.install]: IpcResponse<PluginMeta>;
    [channels.plugins.setEnabled]: IpcResponse<void>;
    [channels.plugins.restart]: IpcResponse<void>;
    [channels.plugins.remove]: IpcResponse<void>;
    [channels.plugins.getConfig]: IpcResponse<PluginConfigSnapshot>;
    [channels.plugins.setConfig]: IpcResponse<PluginConfigSnapshot>;
    [channels.plugins.invoke]: IpcResponse<void>;

    // updater
    [channels.updater.state]: IpcResponse<UpdaterState>;
    [channels.updater.check]: IpcResponse<UpdaterState>;

    // firmware
    [channels.firmware.getState]: IpcResponse<FirmwareState>;
    [channels.firmware.check]: IpcResponse<FirmwareState>;
    [channels.firmware.update]: IpcResponse<FirmwareState>;
    [channels.firmware.flashLocal]: IpcResponse<FirmwareState | null>;
    [channels.firmware.retry]: IpcResponse<FirmwareState>;
    [channels.firmware.cancel]: IpcResponse<FirmwareState>;
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

/** `usb:event` payloads: connection state, `0xA0` actions, transfer progress. */
export interface UsbStatusEvent {
    type: "status";
    status: DeviceStatus;
}

export interface ActionTriggeredEvent {
    type: "action-triggered";
    action: string;
}

export interface TransferProgressEvent {
    type: "transfer-progress";
    phase: "start" | "chunk" | "end" | "retry" | "cancelled";
    targetType: number;
    identity: string;
    sent: number;
    total: number;
    percent: number;
}

export type UsbEventPayload = UsbStatusEvent | ActionTriggeredEvent | TransferProgressEvent;

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

/** `icons:preview` payload: a data URL the renderer can put in an `<img>`. */
export interface IconPreview {
    name: string;
    dataUrl: string;
}

export interface PluginMeta {
    handle: string;
    name: string;
    description: string;
    version: string;
    apiVersion: number;
    iconDataUrl: string | null;
    enabled: boolean;
    status: PluginStatus;
    error: string | null;
    commands: PluginCommand[];
    hasConfig: boolean;
}

export interface UpdaterState {
    state: "idle" | "checking" | "available" | "downloading" | "error";
    version?: string;
}

export type {
    FirmwareCheckRequest,
    FirmwareErrorInfo,
    FirmwareImageInfo,
    FirmwarePhase,
    FirmwareReleaseInfo,
    FirmwareReleaseState,
    FirmwareReleaseStatus,
    FirmwareState,
} from "./firmware";
export type { FlashPhase, FlashProgressPayload } from "./firmware";

export interface ToastPayload {
    level: "info" | "success" | "warning" | "error";
    message: string;
}

export interface SyncProgressPayload {
    phase: string;
    percent: number;
    completed?: number;
    total?: number;
    /** Human-readable label of the item being processed. */
    current?: string;
    message?: string;
}

export type PluginLogLevel = "debug" | "info" | "warn" | "error";

export type PluginEventPayload =
    | { type: "status"; handle: string; status: PluginStatus; error: string | null }
    | { type: "registrations" }
    | { type: "log"; handle: string; level: PluginLogLevel; message: string };

export interface EventPayloadMap {
    [eventChannels.usb]: UsbEventPayload;
    [eventChannels.toast]: ToastPayload;
    [eventChannels.syncProgress]: SyncProgressPayload;
    [eventChannels.plugin]: PluginEventPayload;
    [eventChannels.firmwareState]: FirmwareState;
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
