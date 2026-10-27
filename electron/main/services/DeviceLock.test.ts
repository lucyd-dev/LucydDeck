import { describe, expect, it } from "vitest";
import { DeviceLock, DeviceLockError, deviceBusyMessage } from "./DeviceLock";

describe("DeviceLock", () => {
    it("lets a sync start on an idle deck and keeps an update out", () => {
        const lock = new DeviceLock();

        expect(lock.beginSync()).toBe(true);
        expect(lock.syncing).toBe(true);
        expect(lock.beginUpdate()).toBe(false);
        expect(lock.current()).toBe("sync");
        expect(lock.updating).toBe(false);

        lock.endSync();
        expect(lock.busy).toBe(false);
        expect(lock.beginUpdate()).toBe(true);
    });

    it("keeps a sync out while an update owns the deck", () => {
        const lock = new DeviceLock();

        expect(lock.beginUpdate()).toBe(true);
        expect(lock.updating).toBe(true);
        expect(lock.beginSync()).toBe(false);
        expect(lock.current()).toBe("update");

        lock.endUpdate();
        expect(lock.beginSync()).toBe(true);
    });

    it("refuses an update while a transfer is open", () => {
        const lock = new DeviceLock();

        expect(lock.beginTransfer()).toBe(true);
        expect(lock.transferring).toBe(true);
        expect(lock.beginUpdate()).toBe(false);
        expect(lock.current()).toBe("transfer");

        lock.endTransfer();
        expect(lock.beginUpdate()).toBe(true);
    });

    it("refuses a transfer while an update owns the deck", () => {
        const lock = new DeviceLock();

        expect(lock.beginUpdate()).toBe(true);
        expect(lock.beginTransfer()).toBe(false);
        expect(lock.transferring).toBe(false);
    });

    it("nests transfers inside a sync", () => {
        const lock = new DeviceLock();

        expect(lock.beginSync()).toBe(true);
        expect(lock.beginTransfer()).toBe(true);
        expect(lock.beginTransfer()).toBe(true);
        expect(lock.current()).toBe("sync");
        expect(lock.beginUpdate()).toBe(false);

        lock.endTransfer();
        lock.endTransfer();
        expect(lock.busy).toBe(true);
        lock.endSync();
        expect(lock.busy).toBe(false);
    });

    it("lets a direct write own an idle deck and keeps sync and update out", () => {
        const lock = new DeviceLock();

        expect(lock.beginWrite()).toBe(true);
        expect(lock.writing).toBe(true);
        expect(lock.current()).toBe("write");
        expect(lock.beginSync()).toBe(false);
        expect(lock.beginUpdate()).toBe(false);

        lock.endWrite();
        expect(lock.busy).toBe(false);
        expect(lock.beginSync()).toBe(true);
    });

    it("refuses a direct write while a sync or an update owns the deck", () => {
        const lock = new DeviceLock();

        expect(lock.beginSync()).toBe(true);
        expect(lock.beginWrite()).toBe(false);
        lock.endSync();

        expect(lock.beginUpdate()).toBe(true);
        expect(lock.beginWrite()).toBe(false);
        lock.endUpdate();

        expect(lock.beginTransfer()).toBe(true);
        expect(lock.beginWrite()).toBe(false);
    });

    it("nests a transfer inside a direct write", () => {
        const lock = new DeviceLock();

        expect(lock.beginWrite()).toBe(true);
        expect(lock.beginTransfer()).toBe(true);
        expect(lock.current()).toBe("write");

        lock.endTransfer();
        lock.endWrite();
        expect(lock.busy).toBe(false);
    });

    it("ignores a release from an operation that does not own the deck", () => {
        const lock = new DeviceLock();
        lock.beginSync();

        lock.endUpdate();
        lock.endTransfer();

        expect(lock.syncing).toBe(true);
        expect(lock.busy).toBe(true);
    });

    it("names the operation that holds the deck", () => {
        expect(deviceBusyMessage("sync")).toContain("A sync is running");
        expect(deviceBusyMessage("update")).toContain("firmware operation");
        expect(deviceBusyMessage("transfer")).toContain("file is being sent");
        expect(deviceBusyMessage("write")).toContain("busy with another change");

        const error = new DeviceLockError("update");
        expect(error.code).toBe("DEVICE_BUSY");
        expect(error.message).toBe(deviceBusyMessage("update"));
    });
});
