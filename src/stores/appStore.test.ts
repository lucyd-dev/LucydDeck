import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/ipc/events", () => ({
    on: () => 0,
    eventChannels: { toast: "toast", usb: "usb" },
}));

import { useAppStore } from "./appStore";

describe("appStore toasts", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setActivePinia(createPinia());
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("dismisses a toast once its lifetime is over", () => {
        const app = useAppStore();
        app.pushToast("success", "Device synced");
        expect(app.toasts).toHaveLength(1);

        vi.advanceTimersByTime(3999);
        expect(app.toasts).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(app.toasts).toHaveLength(0);
    });

    it("keeps an error on screen longer than a success", () => {
        const app = useAppStore();
        app.pushToast("error", "Sync failed");

        vi.advanceTimersByTime(4000);
        expect(app.toasts).toHaveLength(1);

        vi.advanceTimersByTime(4000);
        expect(app.toasts).toHaveLength(0);
    });

    it("collapses a repeated message and restarts its timer", () => {
        const app = useAppStore();
        app.pushToast("success", "Device synced");

        vi.advanceTimersByTime(3000);
        app.pushToast("success", "Device synced");
        expect(app.toasts).toHaveLength(1);

        vi.advanceTimersByTime(3999);
        expect(app.toasts).toHaveLength(1);

        vi.advanceTimersByTime(1);
        expect(app.toasts).toHaveLength(0);
    });

    it("keeps at most four toasts and drops the oldest", () => {
        const app = useAppStore();
        for (let index = 0; index < 6; index++) {
            app.pushToast("info", `Message ${index}`);
        }

        expect(app.toasts.map((toast) => toast.message)).toEqual([
            "Message 2",
            "Message 3",
            "Message 4",
            "Message 5",
        ]);
    });

    it("clears the timer of a toast dismissed by hand", () => {
        const app = useAppStore();
        app.pushToast("success", "Device synced");
        app.dismissToast(app.toasts[0]!.id);

        vi.advanceTimersByTime(4000);
        expect(app.toasts).toHaveLength(0);
    });
});
