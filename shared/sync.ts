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

/**
 * One profile rename, sent as `CMD_PROFILE_RENAME`. `from` is the name on the
 * deck, `to` the name in the library. A rename keeps the deck profile and its
 * pages, where create plus prune would lose both.
 */
export interface ProfileRename {
    from: string;
    to: string;
}

export interface DiffPlan {
    /** Profiles present locally but absent on the device (created first). */
    profilesToCreate: string[];
    /** Renames detected one-to-one, sent before pages are uploaded. */
    profileRenames: ProfileRename[];
    /**
     * Why a rename-looking plan was not sent as a rename, or `null`. Set when
     * the page correspondence is ambiguous; such a plan falls back to create
     * plus remove so the sync never guesses which profile became which.
     */
    profileRenameFallback: string | null;
    /** Pages whose local CRC-32 differs from the device list (or are missing). */
    pagesToUpload: SyncPageRef[];
    /** Icons whose local CRC-32 differs from the device list (or are missing). */
    iconsToUpload: SyncIconRef[];
    /** Device pages with no matching local file (removed after the uploads). */
    pagesToDelete: SyncPageRef[];
    /** Device icons with no matching local file (removed after the pages). */
    iconsToDelete: SyncIconRef[];
    /** Device profiles with no matching local profile (removed last). */
    profilesToDelete: string[];
    /** Icons referenced by local pages but present neither locally nor on-device. */
    missingIcons: SyncIconRef[];
    /** Profile to activate after sync, when the user requested one. */
    setActiveProfile: string | null;
}

export interface SyncResult {
    createdProfiles: string[];
    /** Profiles renamed instead of recreated, in the order they were sent. */
    renamedProfiles: ProfileRename[];
    uploadedPages: SyncPageRef[];
    uploadedIcons: SyncIconRef[];
    /** Device pages deleted because the library has no copy. */
    removedPages: SyncPageRef[];
    /** Device icons deleted because the library has no copy. */
    removedIcons: SyncIconRef[];
    /** Device profiles deleted because the library has no copy. */
    removedProfiles: string[];
    activeProfile: string | null;
}

export function emptyDiffPlan(): DiffPlan {
    return {
        profilesToCreate: [],
        profileRenames: [],
        profileRenameFallback: null,
        pagesToUpload: [],
        iconsToUpload: [],
        pagesToDelete: [],
        iconsToDelete: [],
        profilesToDelete: [],
        missingIcons: [],
        setActiveProfile: null,
    };
}

/** Total number of executable operations in a plan (creates, renames, uploads, active). */
export function diffPlanOperations(plan: DiffPlan): number {
    return (
        plan.profilesToCreate.length +
        plan.profileRenames.length +
        plan.pagesToUpload.length +
        plan.iconsToUpload.length +
        (plan.setActiveProfile === null ? 0 : 1)
    );
}

/** Planned removals: device files and profiles that have no local copy. */
export function diffPlanDeletions(plan: DiffPlan): number {
    return plan.pagesToDelete.length + plan.iconsToDelete.length + plan.profilesToDelete.length;
}

/** True when the plan removes at least one deck profile. */
export function planRemovesProfiles(plan: DiffPlan): boolean {
    return plan.profilesToDelete.length > 0;
}

/** True when the plan has nothing to upload, remove or activate. */
export function isDiffPlanEmpty(plan: DiffPlan): boolean {
    return diffPlanOperations(plan) === 0 && diffPlanDeletions(plan) === 0;
}
