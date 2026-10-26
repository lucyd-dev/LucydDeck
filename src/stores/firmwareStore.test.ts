import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { idleFirmwareState } from "@shared/firmware";
import type { FirmwareState } from "@shared/firmware";
import { useFirmwareStore } from "./firmwareStore";

const mocks = vi.hoisted(() => ({
    listeners: new Map<string, (payload: unknown) => void>(),
    pushToast: vi.fn(),
    state: vi.fn(),
    check: vi.fn(),
    update: vi.fn(),
    flashLocal: vi.fn(),
    cancel: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
    firmwareClient: {
        state: mocks.state,
        check: mocks.check,
        update: mocks.update,
        flashLocal: mocks.flashLocal,
        cancel: mocks.cancel,
    },
}));

vi.mock("@/ipc/events", () => ({
    eventChannels: { firmwareState: "firmware:state", flashProgress: "flash:progress" },
    on: (channel: string, handler: (payload: unknown) => void) => {
        mocks.listeners.set(channel, handler);
        return 1;
    },
}));

vi.mock("@/stores/appStore", () => ({
    useAppStore: () => ({ pushToast: mocks.pushToast }),
}));

const RELEASE = {
    version: "0.4.0",
    notesUrl: "https://github.com/lucyd-dev/LucydDeck-firmware/releases/tag/v0.4.0",
    publishedAt: "2026-10-26T02:51:50.000Z",
};

function state(overrides: Partial<FirmwareState> = {}): FirmwareState {
    return { ...idleFirmwareState(), ...overrides };
}

function emit(channel: string, payload: unknown): void {
    mocks.listeners.get(channel)?.(payload);
}

describe("firmwareStore", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        mocks.listeners.clear();
        vi.resetAllMocks();
        mocks.state.mockResolvedValue({ ok: true, data: state() });
        mocks.check.mockResolvedValue({ ok: true, data: state() });
        mocks.update.mockResolvedValue({ ok: true, data: state() });
        mocks.cancel.mockResolvedValue({ ok: true, data: state() });
    });

    it("loads the deck's installed version", async () => {
        mocks.state.mockResolvedValue({
            ok: true,
            data: state({
                installedVersion: "0.4.0",
                board: "WAVESHARE_ESP32_S3_TOUCH_LCD_4_3",
            }),
        });
        const store = useFirmwareStore();
        await store.refresh();

        expect(store.state.installedVersion).toBe("0.4.0");
        expect(store.state.board).toBe("WAVESHARE_ESP32_S3_TOUCH_LCD_4_3");
    });

    it("selects a local image without starting a flash", async () => {
        const image = {
            path: "/tmp/fw.bin",
            name: "fw.bin",
            size: 4096,
            address: 0x10000,
        };
        mocks.flashLocal.mockResolvedValue({
            ok: true,
            data: state({ phase: "ready", image }),
        });
        const store = useFirmwareStore();

        await expect(store.chooseLocal()).resolves.toEqual(image);
        expect(mocks.flashLocal).toHaveBeenCalledWith({});
        expect(store.state.phase).toBe("ready");
    });

    it("leaves the state alone when the picker is cancelled", async () => {
        mocks.flashLocal.mockResolvedValue({ ok: true, data: null });
        const store = useFirmwareStore();

        await expect(store.chooseLocal()).resolves.toBeNull();
        expect(store.state.phase).toBe("idle");
        expect(store.state.image).toBeNull();
    });

    it("flashes only after the confirmation marks the preview confirmed", async () => {
        const image = {
            path: "/tmp/fw.bin",
            name: "fw.bin",
            size: 4096,
            address: 0x10000,
        };
        mocks.flashLocal.mockResolvedValue({
            ok: true,
            data: state({ phase: "done", image, installedVersion: "0.4.0" }),
        });
        const store = useFirmwareStore();

        await expect(store.flashLocal(image)).resolves.toBe(true);
        expect(mocks.flashLocal).toHaveBeenCalledWith({
            path: "/tmp/fw.bin",
            confirmed: true,
        });
        expect(store.state.installedVersion).toBe("0.4.0");
    });

    it("mirrors state and write progress pushed from the main process", () => {
        const store = useFirmwareStore();

        emit("firmware:state", state({ phase: "writing", percent: 0 }));
        expect(store.state.phase).toBe("writing");
        expect(store.state.phase).toBe("writing");

        emit("flash:progress", {
            phase: "writing",
            percent: 42,
            message: "Writing the firmware. Do not unplug the deck.",
        });
        expect(store.progress?.percent).toBe(42);
        expect(store.state.percent).toBe(42);

        emit("firmware:state", state({ phase: "done", installedVersion: "0.4.0" }));
        expect(store.state.phase).toBe("done");
        expect(store.progress).toBeNull();
    });

    it("shows a failed selection as a toast and an error state", async () => {
        mocks.flashLocal.mockResolvedValue({
            ok: false,
            error: "That image is larger than the deck's app slot.",
            code: "FIRMWARE_IMAGE_REJECTED",
        });
        const store = useFirmwareStore();

        await expect(store.chooseLocal()).resolves.toBeNull();
        expect(mocks.pushToast).toHaveBeenCalledWith(
            "error",
            "That image is larger than the deck's app slot.",
        );
        expect(store.state.error).toMatchObject({ code: "FIRMWARE_IMAGE_REJECTED" });
    });

    it("clears a selection through cancel", async () => {
        const store = useFirmwareStore();
        emit("firmware:state", state({ phase: "ready", image: null }));

        await store.cancel();

        expect(mocks.cancel).toHaveBeenCalledTimes(1);
        expect(store.state.phase).toBe("idle");
    });

    it("marks an available release for the Settings dot", async () => {
        mocks.check.mockResolvedValue({
            ok: true,
            data: state({
                release: { status: "available", latest: RELEASE, error: null },
            }),
        });
        const store = useFirmwareStore();

        await store.checkForUpdate();

        expect(mocks.check).toHaveBeenCalledWith({});
        expect(store.updateAvailable).toBe(true);
        expect(store.state.release.latest?.version).toBe("0.4.0");
    });

    it("sends a quiet launch check and keeps its failure quiet", async () => {
        mocks.check.mockResolvedValue({
            ok: false,
            error: "offline",
            code: "FIRMWARE_DOWNLOAD_FAILED",
        });
        const store = useFirmwareStore();

        await store.checkForUpdate({ silent: true });

        expect(mocks.check).toHaveBeenCalledWith({ silent: true });
        expect(mocks.pushToast).not.toHaveBeenCalled();
        expect(store.state.release.status).toBe("idle");
    });

    it("shows a manual check failure as a toast and a release error", async () => {
        mocks.check.mockResolvedValue({
            ok: false,
            error: "Could not reach the firmware release server.",
            code: "FIRMWARE_DOWNLOAD_FAILED",
        });
        const store = useFirmwareStore();

        await store.checkForUpdate();

        expect(mocks.pushToast).toHaveBeenCalledWith(
            "error",
            "Could not reach the firmware release server.",
        );
        expect(store.state.release).toMatchObject({
            status: "error",
            error: { code: "FIRMWARE_DOWNLOAD_FAILED" },
        });
    });

    it("stops offering an update when the deck is up to date", async () => {
        const store = useFirmwareStore();
        emit(
            "firmware:state",
            state({ release: { status: "up-to-date", latest: RELEASE, error: null } }),
        );

        expect(store.updateAvailable).toBe(false);
    });

    it("installs the offered release and reports completion", async () => {
        mocks.update.mockResolvedValue({
            ok: true,
            data: state({
                phase: "done",
                installedVersion: "0.4.0",
                release: { status: "up-to-date", latest: RELEASE, error: null },
            }),
        });
        const store = useFirmwareStore();

        await expect(store.installUpdate()).resolves.toBe(true);
        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(store.state.installedVersion).toBe("0.4.0");
        expect(store.state.release.status).toBe("up-to-date");
    });

    it("shows an update that could not start", async () => {
        mocks.update.mockResolvedValue({
            ok: false,
            error: "There is no update to install.",
            code: "FIRMWARE_NO_UPDATE",
        });
        const store = useFirmwareStore();

        await expect(store.installUpdate()).resolves.toBe(false);
        expect(mocks.pushToast).toHaveBeenCalledWith("error", "There is no update to install.");
        expect(store.state.error).toMatchObject({ code: "FIRMWARE_NO_UPDATE" });
    });
});
