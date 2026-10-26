import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { DeviceState } from "@shared/ipc";
import { useUsbStore } from "./usbStore";

const mocks = vi.hoisted(() => ({
    listeners: new Map<string, (payload: unknown) => void>(),
    pushToast: vi.fn(),
    setDeviceStatus: vi.fn(),
}));

vi.mock("@/ipc/client", () => ({
    usbClient: {},
    syncClient: {},
}));

vi.mock("@/ipc/events", () => ({
    eventChannels: { usb: "usb:event", syncProgress: "sync:progress" },
    on: (channel: string, handler: (payload: unknown) => void) => {
        mocks.listeners.set(channel, handler);
        return 1;
    },
}));

vi.mock("@/stores/appStore", () => ({
    useAppStore: () => ({
        pushToast: mocks.pushToast,
        setDeviceStatus: mocks.setDeviceStatus,
    }),
}));

function emit(channel: string, payload: unknown): void {
    mocks.listeners.get(channel)?.(payload);
}

function transfer(phase: string): void {
    emit("usb:event", {
        type: "transfer-progress",
        phase,
        targetType: 1,
        identity: "main/0",
        sent: 0,
        total: 10,
        percent: 0,
    });
}

describe("usbStore transfer state", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        mocks.listeners.clear();
        vi.clearAllMocks();
    });

    it("reports a standalone transfer until it ends, fails or is cancelled", () => {
        const usb = useUsbStore();
        expect(usb.transferring).toBe(false);

        transfer("start");
        expect(usb.transferring).toBe(true);

        transfer("chunk");
        expect(usb.transferring).toBe(true);

        transfer("end");
        expect(usb.transferring).toBe(false);

        transfer("start");
        transfer("failed");
        expect(usb.transferring).toBe(false);

        transfer("start");
        transfer("cancelled");
        expect(usb.transferring).toBe(false);
    });

    it("clears a transfer when the deck disconnects", () => {
        const usb = useUsbStore();
        transfer("start");

        emit("usb:event", {
            type: "status",
            status: { state: DeviceState.Disconnected, label: "Disconnected" },
        });

        expect(usb.transferring).toBe(false);
    });
});
