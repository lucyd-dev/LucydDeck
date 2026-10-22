// ---------------------------------------------------------------------------
// Delta-sync contracts shared by the main-process `SyncService` and the
// renderer. Pure types + helpers (no node/electron imports).
//
// `DiffPlan` is the reconciler output: local profile/page/icon files compared
// against `CMD_GET_PROFILES_LIST` / `CMD_GET_IMAGES_LIST` by CRC-32.
//
// Note: protocol v1 exposes no file-delete opcode (host commands are create /
// rename / delete-profile / file transfer / set-active only). The delete sets
// are therefore planned and surfaced (so the UI can warn) but cannot be
// executed; `executePlan` reports them as `pendingDeletions`.
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
    /** Device pages with no matching local file (not deletable on protocol v1). */
    pagesToDelete: SyncPageRef[];
    /** Device icons with no matching local file (not deletable on protocol v1). */
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
    /** Planned deletions that protocol v1 cannot execute. */
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
