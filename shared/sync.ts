// ---------------------------------------------------------------------------
// Delta-sync contracts shared by the main-process `SyncService` and the
// renderer. Pure types + helpers (no node/electron imports).
//
// `DiffPlan` is the reconciler output: local profile/page/icon files compared
// against `CMD_GET_PROFILES_LIST` / `CMD_GET_IMAGES_LIST` by CRC-32.
//
// Note: sync uploads and creates only. Device-only files are planned and
// surfaced (so the Device view can offer a delete), but `executePlan` leaves
// them on the deck and reports them as `pendingDeletions`.
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
    /** Device pages with no matching local file (the Device view deletes them). */
    pagesToDelete: SyncPageRef[];
    /** Device icons with no matching local file (the Device view deletes them). */
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
    activeProfile: string | null;
    /** Planned deletions left for the Device view; `executePlan` does not touch them. */
    pendingDeletions: number;
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

/** Planned deletions that the current protocol cannot execute. */
export function diffPlanDeletions(plan: DiffPlan): number {
    return plan.pagesToDelete.length + plan.iconsToDelete.length;
}

/** True when there is nothing to upload and no profile to activate. */
export function isDiffPlanEmpty(plan: DiffPlan): boolean {
    return diffPlanOperations(plan) === 0;
}
