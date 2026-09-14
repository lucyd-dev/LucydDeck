/// <reference types="vite/client" />

import type { LucydApi } from "@shared/ipc";

declare global {
    interface Window {
        readonly lucyd: LucydApi;
    }
}

export {};
