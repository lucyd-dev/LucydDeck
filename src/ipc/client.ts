import { channels } from "@shared/ipc";
import type { IpcChannel, RequestFor, ResponseFor } from "@shared/ipc";
import type { PageConfig } from "@shared/types";
import type { DiffPlan } from "@shared/sync";

/**
 * Typed wrappers over `window.lucyd`. The renderer calls these instead of
 * spelling out channel names; the channel constants + payload types stay in
 * `shared/ipc.ts` so main and renderer can never drift.
 */
async function invoke<C extends IpcChannel>(
    channel: C,
    payload: RequestFor<C>,
): Promise<ResponseFor<C>> {
    return window.lucyd.invoke(channel, payload);
}

export const storageClient = {
    listProfiles: () => invoke(channels.storage.listProfiles, undefined),
    createProfile: (name: string) => invoke(channels.storage.createProfile, { name }),
    renameProfile: (oldName: string, newName: string) =>
        invoke(channels.storage.renameProfile, { oldName, newName }),
    deleteProfile: (name: string) => invoke(channels.storage.deleteProfile, { name }),
    listPages: (profile: string) => invoke(channels.storage.listPages, { name: profile }),
    loadPage: (profile: string, id: string) => invoke(channels.storage.loadPage, { profile, id }),
    savePage: (profile: string, id: string, page: PageConfig) =>
        invoke(channels.storage.savePage, { profile, id, page }),
    exportProfile: (name: string) => invoke(channels.storage.exportProfile, { name }),
    importProfile: () => invoke(channels.storage.importProfile, undefined),
    getDefaultProfile: () => invoke(channels.storage.getDefaultProfile, undefined),
    setDefaultProfile: (name: string | null) =>
        invoke(channels.storage.setDefaultProfile, { name }),
};

export const usbClient = {
    status: () => invoke(channels.usb.status, undefined),
    connect: () => invoke(channels.usb.connect, undefined),
    disconnect: () => invoke(channels.usb.disconnect, undefined),
    deviceInfo: () => invoke(channels.usb.deviceInfo, undefined),
    listImages: () => invoke(channels.usb.listImages, undefined),
    listProfiles: () => invoke(channels.usb.listProfiles, undefined),
    createProfile: (name: string) => invoke(channels.usb.createProfile, { name }),
    renameProfile: (oldName: string, newName: string) =>
        invoke(channels.usb.renameProfile, { oldName, newName }),
    deleteProfile: (name: string) => invoke(channels.usb.deleteProfile, { name }),
    setActiveProfile: (name: string) => invoke(channels.usb.setActiveProfile, { name }),
    setActivePage: (id: string) => invoke(channels.usb.setActivePage, { id }),
    uploadPage: (profile: string, id: string) => invoke(channels.usb.uploadPage, { profile, id }),
    uploadIcon: (name: string) => invoke(channels.usb.uploadIcon, { name }),
};

export const iconsClient = {
    list: () => invoke(channels.icons.list, undefined),
    /** Import picked files; omit `paths` to open the native picker. */
    import: (paths?: string[]) => invoke(channels.icons.import, paths === undefined ? {} : { paths }),
    importData: (name: string, dataUrl: string) =>
        invoke(channels.icons.importData, { name, dataUrl }),
    remove: (name: string) => invoke(channels.icons.remove, { name }),
    preview: (name: string) => invoke(channels.icons.preview, { name }),
};

export const syncClient = {
    reconcile: (activeProfile?: string) =>
        invoke(channels.sync.reconcile, activeProfile === undefined ? {} : { activeProfile }),
    execute: (plan: DiffPlan) => invoke(channels.sync.execute, { plan }),
};

export const pluginsClient = {
    list: () => invoke(channels.plugins.list, undefined),
    setEnabled: (id: string, enabled: boolean) =>
        invoke(channels.plugins.setEnabled, { id, enabled }),
    remove: (id: string) => invoke(channels.plugins.remove, { id }),
};

export const updaterClient = {
    state: () => invoke(channels.updater.state, undefined),
    check: () => invoke(channels.updater.check, undefined),
};

export const firmwareClient = {
    state: () => invoke(channels.firmware.getState, undefined),
    update: () => invoke(channels.firmware.update, undefined),
};
