import { ref } from "vue";
import { defineStore } from "pinia";

export interface ConfirmRequest {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
}

/**
 * Promise-based replacement for `window.confirm`. `AppShell` renders the one
 * `ConfirmDialog` and resolves the pending promise, so callers (stores
 * included) can await a real composeable dialog.
 */
export const useConfirmStore = defineStore("confirm", () => {
    const request = ref<ConfirmRequest | null>(null);
    let resolvePending: ((confirmed: boolean) => void) | null = null;

    function ask(next: ConfirmRequest): Promise<boolean> {
        resolvePending?.(false);
        request.value = next;
        return new Promise<boolean>((resolve) => {
            resolvePending = resolve;
        });
    }

    function answer(confirmed: boolean): void {
        const resolve = resolvePending;
        resolvePending = null;
        request.value = null;
        resolve?.(confirmed);
    }

    return { request, ask, answer };
});
