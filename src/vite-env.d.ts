/// <reference types="vite/client" />

import type { LucydApi } from "@shared/ipc";

declare global {
    interface Window {
        readonly lucyd: LucydApi;
        /** Best-effort autosave flush, called by the main process on quit. */
        lucydEditorFlush?: () => Promise<boolean>;
    }
}

export {};
