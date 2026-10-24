import fs from "node:fs";
import log from "electron-log/main";
import {
    type DeviceImageEntry,
    type DevicePageEntry,
    type DeviceProfileEntry,
    isValidPageId,
    pageIdFromFilename,
} from "@shared/protocol";
import { iconBaseName } from "@shared/icons";
import type { SyncProgressPayload, TransferProgressEvent } from "@shared/ipc";
import {
    type DiffPlan,
    type SyncResult,
    diffPlanDeletions,
    diffPlanOperations,
    emptyDiffPlan,
} from "@shared/sync";
import { serializePageConfig, validatePageConfig } from "@shared/schema";
import { crc32Upload } from "./usb/Crc32";
import type { StorageService } from "./StorageService";

export const SyncErrorCodes = {
    InvalidPage: "SYNC_INVALID_PAGE",
} as const;

export class SyncError extends Error {
    readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = "SyncError";
        this.code = code;
    }
}

/** Minimal device surface `SyncService` needs (satisfied by `DeviceService`). */
export interface SyncDeviceClient {
    listProfiles(): Promise<DeviceProfileEntry[]>;
    listImages(): Promise<DeviceImageEntry[]>;
    createProfile(name: string): Promise<void>;
    setActiveProfile(name: string): Promise<void>;
    uploadPage(profile: string, id: string | number, json: string | Uint8Array): Promise<void>;
    uploadIcon(name: string, pngBytes: Uint8Array): Promise<void>;
    deletePage(
        profile: string,
        id: string | number,
        options?: { allowMissing?: boolean },
    ): Promise<void>;
    deleteIcon(name: string, options?: { allowMissing?: boolean }): Promise<void>;
}

/** Minimal transfer surface for per-chunk progress (satisfied by `FileTransfer`). */
export interface SyncTransferClient {
    onEvent(listener: (event: TransferProgressEvent) => void): () => void;
}

export interface ReconcileOptions {
    /** Profile the user wants active after sync. */
    activeProfile?: string;
}

export interface SyncServiceOptions {
    onProgress?: (payload: SyncProgressPayload) => void;
}

const encoder = new TextEncoder();

/** Normalize a device page entry to its canonical id, or null when unusable. */
function normalizePageId(entry: DevicePageEntry): string | null {
    if (entry.id !== undefined && entry.id !== null && String(entry.id) !== "") {
        const id = String(entry.id);
        return isValidPageId(id) ? id : null;
    }
    return pageIdFromFilename(entry.filename ?? "");
}

/** Coerce a device list hash to a uint32; `null` when absent/unreadable. */
function normalizeHash(value: unknown): number | null {
    const hash = Number(value);
    if (!Number.isFinite(hash)) {
        return null;
    }
    return hash >>> 0;
}

/**
 * Differential delta-sync engine.
 *
 * `reconcile()` fetches the device profile/image lists and compares them with
 * the local `profiles/` + `icons/` directories using CRC-32 (the same hash the
 * firmware reports). `executePlan()` creates missing profiles first, then
 * uploads icons and pages, then activates the requested profile, emitting
 * `sync:progress` payloads throughout.
 *
 * Protocol v1 has no file-delete opcode, so `pagesToDelete`/`iconsToDelete`
 * are planned and reported (the UI confirms them) but not executed.
 */
export class SyncService {
    private readonly storage: StorageService;
    private readonly device: SyncDeviceClient;
    private readonly transfer: SyncTransferClient;
    private readonly listeners = new Set<(payload: SyncProgressPayload) => void>();

    constructor(
        storage: StorageService,
        device: SyncDeviceClient,
        transfer: SyncTransferClient,
        options: SyncServiceOptions = {},
    ) {
        this.storage = storage;
        this.device = device;
        this.transfer = transfer;
        if (options.onProgress) {
            this.listeners.add(options.onProgress);
        }
    }

    onProgress(listener: (payload: SyncProgressPayload) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emitProgress(payload: SyncProgressPayload): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(payload);
            } catch (error) {
                log.warn(`[sync] progress listener failed: ${String(error)}`);
            }
        }
    }

    /**
     * Compare local state with the device and return the upload plan. Does not
     * mutate the device.
     */
    async reconcile(options: ReconcileOptions = {}): Promise<DiffPlan> {
        const [deviceProfiles, deviceImages] = await Promise.all([
            this.device.listProfiles(),
            this.device.listImages(),
        ]);

        const plan = emptyDiffPlan();
        const localProfiles = this.storage.listProfiles().map((profile) => profile.name);
        const deviceByName = new Map(deviceProfiles.map((profile) => [profile.name, profile]));
        const localIcons = this.storage.listIconFiles();
        const localIconNames = new Set(localIcons.map((icon) => icon.name));
        const deviceIcons = new Map<string, number | null>(
            deviceImages.map((image) => [iconBaseName(image.filename), normalizeHash(image.hash)]),
        );
        const referencedIcons = new Set<string>();

        for (const profile of localProfiles) {
            const deviceProfile = deviceByName.get(profile);
            if (!deviceProfile) {
                plan.profilesToCreate.push(profile);
            }
            const devicePages = new Map<string, number | null>();
            for (const page of deviceProfile?.pages ?? []) {
                const id = normalizePageId(page);
                if (id !== null) {
                    devicePages.set(id, normalizeHash(page.hash));
                }
            }

            const localPages = this.storage.listPages(profile);
            const localIds = new Set(localPages.map((page) => page.id));
            for (const meta of localPages) {
                let page;
                try {
                    page = this.storage.loadPage(profile, meta.id);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new SyncError(
                        `Page ${profile}/${meta.id}.json could not be read: ${message}`,
                        SyncErrorCodes.InvalidPage,
                    );
                }
                const validation = validatePageConfig(page);
                if (!validation.ok) {
                    throw new SyncError(
                        `Page ${profile}/${meta.id}.json is invalid: ${validation.errors.join("; ")}`,
                        SyncErrorCodes.InvalidPage,
                    );
                }
                for (const button of Object.values(validation.page.buttons)) {
                    if (button.imageName) {
                        referencedIcons.add(button.imageName);
                    }
                }
                const canonical = serializePageConfig(validation.page);
                const bytes = encoder.encode(JSON.stringify(canonical));
                const localHash = crc32Upload(bytes);
                const deviceHash = devicePages.get(meta.id);
                if (deviceHash === undefined || deviceHash === null || deviceHash !== localHash) {
                    plan.pagesToUpload.push({ profile, id: meta.id });
                }
            }

            for (const id of devicePages.keys()) {
                if (!localIds.has(id)) {
                    plan.pagesToDelete.push({ profile, id });
                }
            }
        }

        for (const icon of localIcons) {
            let localHash: number | null;
            try {
                localHash = this.storage.iconHash(icon.name);
            } catch (error) {
                // A filename that fails `validateName` cannot be uploaded; skip.
                log.warn(`[sync] icon "${icon.name}" has an invalid name: ${String(error)}`);
                continue;
            }
            const deviceHash = deviceIcons.get(icon.name);
            if (
                localHash === null ||
                deviceHash === undefined ||
                deviceHash === null ||
                deviceHash !== localHash
            ) {
                plan.iconsToUpload.push({ name: icon.name });
            }
        }

        for (const name of deviceIcons.keys()) {
            if (!localIconNames.has(name)) {
                plan.iconsToDelete.push({ name });
            }
        }

        for (const name of referencedIcons) {
            if (!localIconNames.has(name) && !deviceIcons.has(name)) {
                plan.missingIcons.push({ name });
            }
        }

        const requested = options.activeProfile;
        if (
            requested !== undefined &&
            requested !== "" &&
            (localProfiles.includes(requested) || deviceByName.has(requested))
        ) {
            plan.setActiveProfile = requested;
        }

        return plan;
    }

    /**
     * Execute a plan. Creates profiles before any page upload, uploads icons
     * before pages, then removes device files that have no local copy and
     * activates the requested profile. Aborts on the first device error; the
     * plan can be recomputed and resumed on the next run.
     */
    async executePlan(plan: DiffPlan): Promise<SyncResult> {
        const total = diffPlanOperations(plan) + diffPlanDeletions(plan);
        const result: SyncResult = {
            createdProfiles: [],
            uploadedPages: [],
            uploadedIcons: [],
            removedPages: [],
            removedIcons: [],
            activeProfile: null,
        };
        let completed = 0;
        const tick = (phase: string, current: string): void => {
            completed++;
            this.emitProgress({
                phase,
                percent: total === 0 ? 100 : Math.round((completed / total) * 100),
                completed,
                total,
                current,
            });
        };

        this.emitProgress({ phase: "prepare", percent: 0, completed: 0, total });

        const unsubscribe = this.transfer.onEvent((event) => {
            if (event.type !== "transfer-progress") {
                return;
            }
            this.emitProgress({
                phase: `transfer:${event.phase}`,
                percent: event.percent,
                completed,
                total,
                current: event.identity,
                message: `${event.identity} ${event.percent}%`,
            });
        });

        try {
            for (const name of plan.profilesToCreate) {
                await this.device.createProfile(name);
                result.createdProfiles.push(name);
                tick("profile", name);
            }

            for (const icon of plan.iconsToUpload) {
                const path = this.storage.iconFilePath(icon.name);
                if (!fs.existsSync(path)) {
                    log.warn(`[sync] icon "${icon.name}" vanished before upload; skipping`);
                    continue;
                }
                await this.device.uploadIcon(icon.name, new Uint8Array(fs.readFileSync(path)));
                result.uploadedIcons.push(icon);
                tick("icon", icon.name);
            }

            for (const page of plan.pagesToUpload) {
                let loaded;
                try {
                    loaded = this.storage.loadPage(page.profile, page.id);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new SyncError(
                        `Page ${page.profile}/${page.id}.json could not be read: ${message}`,
                        SyncErrorCodes.InvalidPage,
                    );
                }
                const validation = validatePageConfig(loaded);
                if (!validation.ok) {
                    throw new SyncError(
                        `Page ${page.profile}/${page.id}.json is invalid: ${validation.errors.join(
                            "; ",
                        )}`,
                        SyncErrorCodes.InvalidPage,
                    );
                }
                await this.device.uploadPage(
                    page.profile,
                    page.id,
                    JSON.stringify(serializePageConfig(validation.page)),
                );
                result.uploadedPages.push(page);
                tick("page", `${page.profile}/${page.id}`);
            }

            // Pages before icons: removing an icon first would leave a page that
            // is still on the deck pointing at a missing image.
            for (const page of plan.pagesToDelete) {
                await this.device.deletePage(page.profile, page.id, { allowMissing: true });
                result.removedPages.push(page);
                tick("remove-page", `${page.profile}/${page.id}`);
            }

            for (const icon of plan.iconsToDelete) {
                await this.device.deleteIcon(icon.name, { allowMissing: true });
                result.removedIcons.push(icon);
                tick("remove-icon", icon.name);
            }

            if (plan.pagesToDelete.length > 0 || plan.iconsToDelete.length > 0) {
                log.info(
                    `[sync] removed ${plan.pagesToDelete.length} page(s) and ` +
                        `${plan.iconsToDelete.length} icon(s) with no local copy`,
                );
            }

            if (plan.setActiveProfile !== null) {
                await this.device.setActiveProfile(plan.setActiveProfile);
                result.activeProfile = plan.setActiveProfile;
                tick("active", plan.setActiveProfile);
            }

            this.emitProgress({ phase: "done", percent: 100, completed: total, total });
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.emitProgress({
                phase: "aborted",
                percent: total === 0 ? 0 : Math.round((completed / total) * 100),
                completed,
                total,
                message,
            });
            throw error;
        } finally {
            unsubscribe();
        }
    }
}
