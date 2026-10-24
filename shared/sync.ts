// ---------------------------------------------------------------------------
// Delta-sync contracts shared by the main-process `SyncService` and the
// renderer. Pure types + helpers (no node/electron imports).
//
// `DiffPlan` is the reconciler output: local profile/page/icon files compared
// against `CMD_GET_PROFILES_LIST` / `CMD_GET_IMAGES_LIST` by CRC-32. A plan
// carries both directions: files to upload and device files to remove.
// ---------------------------------------------------------------------------

export interface SyncPageRef {
    profile: string;
    id: string;
}

export interface SyncIconRef {
    name: string;
}

export interface DiffPlan {
    /** Profiles present locally but absent on the device (created first). */
    profilesToCreate: string[];
    /** Pages whose local CRC-32 differs from the device list (or are missing). */
    pagesToUpload: SyncPageRef[];
    /** Icons whose local CRC-32 differs from the device list (or are missing). */
    iconsToUpload: SyncIconRef[];
    /** Device pages with no matching local file (removed after the uploads). */
    pagesToDelete: SyncPageRef[];
    /** Device icons with no matching local file (removed after the pages). */
    iconsToDelete: SyncIconRef[];
    /** Icons referenced by local pages but present neither locally nor on-device. */
    missingIcons: SyncIconRef[];
    /** Profile to activate after sync, when the user requested one. */
    setActiveProfile: string | null;
}

export interface SyncResult {
    createdProfiles: string[];
    uploadedPages: SyncPageRef[];
    uploadedIcons: SyncIconRef[];
    /** Device pages deleted because the library has no copy. */
    removedPages: SyncPageRef[];
    /** Device icons deleted because the library has no copy. */
    removedIcons: SyncIconRef[];
    activeProfile: string | null;
}

export function emptyDiffPlan(): DiffPlan {
    return {
        profilesToCreate: [],
        pagesToUpload: [],
        iconsToUpload: [],
        pagesToDelete: [],
        iconsToDelete: [],
        missingIcons: [],
        setActiveProfile: null,
    };
}

/** Total number of executable operations in a plan (uploads + creates + active). */
export function diffPlanOperations(plan: DiffPlan): number {
    return (
        plan.profilesToCreate.length +
        plan.pagesToUpload.length +
        plan.iconsToUpload.length +
        (plan.setActiveProfile === null ? 0 : 1)
    );
}

/** Planned removals: device files that have no local copy. */
export function diffPlanDeletions(plan: DiffPlan): number {
    return plan.pagesToDelete.length + plan.iconsToDelete.length;
}

/** True when the plan has nothing to upload, remove or activate. */
export function isDiffPlanEmpty(plan: DiffPlan): boolean {
    return diffPlanOperations(plan) === 0 && diffPlanDeletions(plan) === 0;
}
