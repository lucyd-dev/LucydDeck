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
import { isValidEntityName, sanitizeEntityName } from "@shared/names";
import { isPluginHandle } from "@shared/plugins";
import type { SyncProgressPayload, TransferProgressEvent } from "@shared/ipc";
import {
    type DiffPlan,
    type ProfileRename,
    type SyncResult,
    diffPlanDeletions,
    diffPlanOperations,
    emptyDiffPlan,
} from "@shared/sync";
import { serializePageConfig, validatePageConfig } from "@shared/schema";
import { crc32Upload } from "./usb/Crc32";
import type { StorageService } from "./StorageService";
import { DeviceLockError } from "./DeviceLock";
import type { DeviceLock } from "./DeviceLock";

export const SyncErrorCodes = {
    InvalidPage: "SYNC_INVALID_PAGE",
    UnreadableLibrary: "SYNC_UNREADABLE_LIBRARY",
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
    renameProfile(oldName: string, newName: string): Promise<void>;
    setActiveProfile(name: string): Promise<void>;
    uploadPage(profile: string, id: string | number, json: string | Uint8Array): Promise<void>;
    uploadIcon(
        name: string,
        pngBytes: Uint8Array,
        options?: { allowLegacyName?: boolean },
    ): Promise<void>;
    deletePage(
        profile: string,
        id: string | number,
        options?: { allowMissing?: boolean },
    ): Promise<void>;
    deleteIcon(name: string, options?: { allowMissing?: boolean }): Promise<void>;
    deleteProfile(name: string, options?: { allowMissing?: boolean }): Promise<void>;
}

/** Minimal transfer surface for per-chunk progress (satisfied by `FileTransfer`). */
export interface SyncTransferClient {
    onEvent(listener: (event: TransferProgressEvent) => void): () => void;
}

export interface ReconcileOptions {
    /** Profile the user wants active after sync. */
    activeProfile?: string;
}

export interface ExecutePlanOptions {
    /**
     * Send the removals in the plan. Only a sync the user starts sets this,
     * currently the Sync action; autosync leaves it false so a background pass
     * cannot wipe deck state.
     */
    allowRemovals?: boolean;
}

export interface SyncServiceOptions {
    onProgress?: (payload: SyncProgressPayload) => void;
    /**
     * `handle:command` values the enabled plugins register. Anything a local
     * page runs that is absent from this list is reported, never blocked.
     */
    pluginCommands?: () => readonly string[];
    /** Shared deck ownership; an execute is refused while an update runs. */
    lock?: DeviceLock;
}

const encoder = new TextEncoder();

/** One local profile as the reconciler sees it: canonical page CRCs. */
interface LocalProfileScan {
    name: string;
    pages: Map<string, number>;
}

/** One deck profile as the reconciler sees it; `null` for an unreadable hash. */
interface DeviceProfileScan {
    name: string;
    pages: Map<string, number | null>;
}

interface LocalScan {
    profiles: LocalProfileScan[];
    referencedIcons: Set<string>;
    /** `handle:command` bodies every local CMD step runs. */
    pluginCommands: Set<string>;
}

/**
 * Normalize a device page entry to its canonical id, or null when unusable.
 */
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

function unreadable(what: string, error: unknown): SyncError {
    const message = error instanceof Error ? error.message : String(error);
    return new SyncError(
        `The library could not be read (${what}): ${message}`,
        SyncErrorCodes.UnreadableLibrary,
    );
}

/**
 * Read and validate every local profile before anything is planned.
 *
 * A page that cannot be read or validated aborts the whole reconcile rather
 * than planning a deletion for it: a broken library must not look like an
 * empty one.
 */
function scanLocalProfiles(storage: StorageService): LocalScan {
    let names: string[];
    try {
        names = storage.listProfiles().map((profile) => profile.name);
    } catch (error) {
        throw unreadable("profile list", error);
    }

    const referencedIcons = new Set<string>();
    const pluginCommands = new Set<string>();
    const profiles: LocalProfileScan[] = [];
    for (const name of names) {
        let metas;
        try {
            metas = storage.listPages(name);
        } catch (error) {
            throw unreadable(`pages of "${name}"`, error);
        }
        const pages = new Map<string, number>();
        for (const meta of metas) {
            let page;
            try {
                page = storage.loadPage(name, meta.id);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new SyncError(
                    `Page ${name}/${meta.id}.json could not be read: ${message}`,
                    SyncErrorCodes.InvalidPage,
                );
            }
            const validation = validatePageConfig(page);
            if (!validation.ok) {
                throw new SyncError(
                    `Page ${name}/${meta.id}.json is invalid: ${validation.errors.join("; ")}`,
                    SyncErrorCodes.InvalidPage,
                );
            }
            for (const button of Object.values(validation.page.buttons)) {
                if (button.imageName) {
                    referencedIcons.add(button.imageName);
                }
                for (const step of button.click) {
                    if (step.startsWith("CMD:")) {
                        const body = step.slice("CMD:".length);
                        const separator = body.indexOf(":");
                        // Only a well-formed handle:command is a plugin step;
                        // a legacy `CMD:explorer.exe` has no plugin to miss.
                        if (separator > 0 && isPluginHandle(body.slice(0, separator))) {
                            pluginCommands.add(body);
                        }
                    }
                }
            }
            const canonical = serializePageConfig(validation.page);
            pages.set(meta.id, crc32Upload(encoder.encode(JSON.stringify(canonical))));
        }
        profiles.push({ name, pages });
    }
    return { profiles, referencedIcons, pluginCommands };
}

function scanDeviceProfiles(entries: readonly DeviceProfileEntry[]): DeviceProfileScan[] {
    return entries.map((profile) => {
        const pages = new Map<string, number | null>();
        for (const page of profile.pages ?? []) {
            const id = normalizePageId(page);
            if (id !== null) {
                pages.set(id, normalizeHash(page.hash));
            }
        }
        return { name: profile.name, pages };
    });
}

/**
 * True when every deck page of `device` exists in `local` with the same CRC,
 * which is what a rename leaves behind: the local directory is the deck
 * profile under a new name, possibly with extra pages added since.
 */
function devicePagesCorrespond(device: DeviceProfileScan, local: LocalProfileScan): boolean {
    if (device.pages.size === 0) {
        // No deck page to match: a rename would be a guess. Create plus remove
        // is correct when nothing proves the two profiles are one.
        return false;
    }
    for (const [id, hash] of device.pages) {
        if (hash === null || local.pages.get(id) !== hash) {
            return false;
        }
    }
    return true;
}

interface RenameAssessment {
    rename: ProfileRename | null;
    /** Set when the plan looked like a rename but could not be resolved safely. */
    fallbackReason: string | null;
}

/**
 * Detect a one-to-one rename: exactly one deck-only profile, exactly one
 * library-only profile, their pages correspond, and no other pair on either
 * side corresponds too. Anything else falls back to create plus remove, the
 * behaviour without rename detection.
 */
function detectRename(local: LocalScan, device: readonly DeviceProfileScan[]): RenameAssessment {
    const localNames = new Set(local.profiles.map((profile) => profile.name));
    const deviceByName = new Map(device.map((profile) => [profile.name, profile]));
    const deviceOnly = device.filter((profile) => !localNames.has(profile.name));
    const localOnly = local.profiles.filter((profile) => !deviceByName.has(profile.name));

    const candidates: ProfileRename[] = [];
    for (const from of deviceOnly) {
        for (const to of localOnly) {
            if (devicePagesCorrespond(from, to)) {
                candidates.push({ from: from.name, to: to.name });
            }
        }
    }
    if (candidates.length === 0) {
        return { rename: null, fallbackReason: null };
    }

    if (deviceOnly.length === 1 && localOnly.length === 1 && candidates.length === 1) {
        const [candidate] = candidates;
        const deviceProfile = deviceOnly[0];
        const localProfile = localOnly[0];
        const otherLocal = local.profiles.filter(
            (profile) =>
                profile.name !== candidate.to && devicePagesCorrespond(deviceProfile, profile),
        );
        const otherDevice = device.filter(
            (profile) =>
                profile.name !== candidate.from && devicePagesCorrespond(profile, localProfile),
        );
        if (otherLocal.length === 0 && otherDevice.length === 0) {
            return { rename: candidate, fallbackReason: null };
        }
    }

    const deviceNames = deviceOnly.map((profile) => `"${profile.name}"`).join(", ");
    const localList = localOnly.map((profile) => `"${profile.name}"`).join(", ");
    return {
        rename: null,
        fallbackReason:
            `The pages of ${deviceNames} on the deck also match ${localList} in the library, ` +
            "but not one-to-one; not guessing a rename. The sync creates the local profile " +
            "and removes the deck one instead.",
    };
}

/**
 * Differential delta-sync engine.
 *
 * `reconcile()` fetches the device profile/image lists and compares them with
 * the local `profiles/` + `icons/` directories using CRC-32 (the same hash the
 * firmware reports). `executePlan()` creates missing profiles, sends detected
 * renames, then uploads icons and pages, then removes page, icon and profile
 * entries with no local copy, and activates the requested profile, emitting
 * `sync:progress` payloads throughout.
 *
 * Removals are part of the plan but run only when the caller allows them: an
 * explicit sync passes `allowRemovals`, autosync does not.
 */
export class SyncService {
    private readonly storage: StorageService;
    private readonly device: SyncDeviceClient;
    private readonly transfer: SyncTransferClient;
    private readonly pluginCommands: () => readonly string[];
    private readonly lock: DeviceLock | undefined;
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
        this.pluginCommands = options.pluginCommands ?? (() => []);
        this.lock = options.lock;
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
     * Compare local state with the device and return the plan. Does not mutate
     * the device.
     */
    async reconcile(options: ReconcileOptions = {}): Promise<DiffPlan> {
        const [deviceProfiles, deviceImages] = await Promise.all([
            this.device.listProfiles(),
            this.device.listImages(),
        ]);

        const plan = emptyDiffPlan();
        const local = scanLocalProfiles(this.storage);
        const enabledPluginCommands = new Set(this.pluginCommands());
        for (const command of local.pluginCommands) {
            if (!enabledPluginCommands.has(command)) {
                plan.missingPluginCommands.push(command);
            }
        }
        plan.missingPluginCommands.sort();
        const device = scanDeviceProfiles(deviceProfiles);
        const localNames = new Set(local.profiles.map((profile) => profile.name));
        const deviceByName = new Map(device.map((profile) => [profile.name, profile]));

        const assessment = detectRename(local, device);
        const rename = assessment.rename;
        if (rename !== null) {
            plan.profileRenames.push(rename);
            log.info(`[sync] profile rename detected: "${rename.from}" -> "${rename.to}"`);
        } else if (assessment.fallbackReason !== null) {
            plan.profileRenameFallback = assessment.fallbackReason;
            log.warn(`[sync] ${assessment.fallbackReason}`);
        }

        for (const profile of local.profiles) {
            const isRenameTarget = rename !== null && rename.to === profile.name;
            const comparisonName =
                rename !== null && rename.to === profile.name ? rename.from : profile.name;
            const deviceProfile = deviceByName.get(comparisonName);
            if (!deviceByName.has(profile.name) && !isRenameTarget) {
                plan.profilesToCreate.push(profile.name);
            }

            // A rename target is compared against the deck profile it becomes,
            // so only pages that changed or were added are uploaded; every page
            // it already holds stays where it is.
            const devicePages = deviceProfile?.pages ?? new Map<string, number | null>();
            for (const [id, localHash] of profile.pages) {
                const deviceHash = devicePages.get(id);
                if (deviceHash === undefined || deviceHash === null || deviceHash !== localHash) {
                    plan.pagesToUpload.push({ profile: profile.name, id });
                }
            }
            for (const id of devicePages.keys()) {
                if (!profile.pages.has(id)) {
                    plan.pagesToDelete.push({ profile: profile.name, id });
                }
            }
        }

        const localIcons = this.storage.listIconFiles();
        const localIconNames = new Set(localIcons.map((icon) => icon.name));
        const deviceIcons = new Map<string, number | null>(
            deviceImages.map((image) => [iconBaseName(image.filename), normalizeHash(image.hash)]),
        );

        for (const icon of localIcons) {
            let localHash: number | null;
            try {
                localHash = this.storage.iconHash(icon.name);
            } catch (error) {
                // A filename that fails `validateName` cannot be uploaded; skip.
                log.warn(`[sync] icon "${icon.name}" has an invalid name: ${String(error)}`);
                continue;
            }
            if (!isValidEntityName(icon.name) && !deviceIcons.has(icon.name)) {
                // A legacy name is only writable when the deck already has that
                // file (the firmware's overwrite exception). A new one would be
                // rejected, so leave it out instead of aborting the whole sync.
                const sanitized = sanitizeEntityName(icon.name);
                log.warn(
                    `[sync] icon "${icon.name}" cannot be created on the deck: not an entity name` +
                        (sanitized === ""
                            ? ""
                            : ` (would sanitize to "${sanitized}"); rename the file to send it`) +
                        "; skipping",
                );
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

        for (const name of local.referencedIcons) {
            if (!localIconNames.has(name) && !deviceIcons.has(name)) {
                plan.missingIcons.push({ name });
            }
        }

        // Fail closed: an empty library is far more likely to be a broken or
        // unmounted data directory than a user who wants every deck profile
        // gone. Pages and icons keep their existing behaviour.
        const profilesToPrune = device.filter(
            (profile) =>
                !localNames.has(profile.name) && (rename === null || rename.from !== profile.name),
        );
        if (local.profiles.length === 0) {
            if (profilesToPrune.length > 0) {
                log.info(
                    `[sync] the library has no profiles; leaving ${profilesToPrune.length} ` +
                        "deck profile(s) in place",
                );
            }
        } else {
            for (const profile of profilesToPrune) {
                plan.profilesToDelete.push(profile.name);
            }
        }

        const requested = options.activeProfile;
        if (
            requested !== undefined &&
            requested !== "" &&
            (localNames.has(requested) || deviceByName.has(requested)) &&
            !plan.profilesToDelete.includes(requested)
        ) {
            plan.setActiveProfile = requested;
        }

        return plan;
    }

    /**
     * Execute a plan. Creates profiles, sends renames, uploads icons and pages,
     * then removes device files and profiles that have no local copy, then
     * activates the requested profile. Removals run only when the caller
     * passes `allowRemovals`. Aborts on the first device error; the plan can be
     * recomputed and resumed on the next run.
     *
     * A sync owns the deck for its whole run, so a firmware update cannot start
     * in the middle of one. The lock is released however the plan ends.
     */
    async executePlan(plan: DiffPlan, options: ExecutePlanOptions = {}): Promise<SyncResult> {
        if (this.lock !== undefined && !this.lock.beginSync()) {
            throw new DeviceLockError(this.lock.current() ?? "update");
        }
        try {
            return await this.executePlanLocked(plan, options);
        } finally {
            this.lock?.endSync();
        }
    }

    private async executePlanLocked(
        plan: DiffPlan,
        options: ExecutePlanOptions = {},
    ): Promise<SyncResult> {
        const allowRemovals = options.allowRemovals === true;
        const pagesToDelete = allowRemovals ? plan.pagesToDelete : [];
        const iconsToDelete = allowRemovals ? plan.iconsToDelete : [];
        const profilesToDelete = allowRemovals ? plan.profilesToDelete : [];
        const skippedRemovals = allowRemovals ? 0 : diffPlanDeletions(plan);
        const total = diffPlanOperations(plan) + (allowRemovals ? diffPlanDeletions(plan) : 0);
        const result: SyncResult = {
            createdProfiles: [],
            renamedProfiles: [],
            uploadedPages: [],
            uploadedIcons: [],
            removedPages: [],
            removedIcons: [],
            removedProfiles: [],
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

        if (skippedRemovals > 0) {
            log.info(
                `[sync] skipping ${skippedRemovals} removal(s): only an explicit sync removes`,
            );
        }

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

            // A rename must land before a page is uploaded under the new name,
            // and it keeps the deck profile's pages instead of recreating them.
            for (const rename of plan.profileRenames) {
                await this.device.renameProfile(rename.from, rename.to);
                result.renamedProfiles.push(rename);
                tick("rename", `${rename.from} -> ${rename.to}`);
            }

            for (const icon of plan.iconsToUpload) {
                const path = this.storage.iconFilePath(icon.name);
                if (!fs.existsSync(path)) {
                    log.warn(`[sync] icon "${icon.name}" vanished before upload; skipping`);
                    continue;
                }
                await this.device.uploadIcon(icon.name, new Uint8Array(fs.readFileSync(path)), {
                    // A reconcile plan only keeps a legacy name when the deck
                    // already has that file, so this is the firmware's overwrite
                    // exception rather than a new name.
                    allowLegacyName: !isValidEntityName(icon.name),
                });
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
            for (const page of pagesToDelete) {
                await this.device.deletePage(page.profile, page.id, { allowMissing: true });
                result.removedPages.push(page);
                tick("remove-page", `${page.profile}/${page.id}`);
            }

            for (const icon of iconsToDelete) {
                await this.device.deleteIcon(icon.name, { allowMissing: true });
                result.removedIcons.push(icon);
                tick("remove-icon", icon.name);
            }

            // Profiles last: a profile must never go before the pages it holds
            // are settled, since deleting it takes its whole directory with it.
            for (const name of profilesToDelete) {
                await this.device.deleteProfile(name, { allowMissing: true });
                result.removedProfiles.push(name);
                tick("remove-profile", name);
            }

            if (
                result.removedPages.length > 0 ||
                result.removedIcons.length > 0 ||
                result.removedProfiles.length > 0
            ) {
                log.info(
                    `[sync] removed ${result.removedPages.length} page(s), ` +
                        `${result.removedIcons.length} icon(s) and ` +
                        `${result.removedProfiles.length} profile(s) with no local copy`,
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
