import { describe, expect, it } from "vitest";
import { channels, eventChannels, listChannels, listEventChannels } from "./ipc";

describe("shared/ipc contract", () => {
    it("keeps every request channel name unique", () => {
        const names = listChannels();
        expect(new Set(names).size).toBe(names.length);
    });

    it("keeps every event channel name unique", () => {
        const names = listEventChannels();
        expect(new Set(names).size).toBe(names.length);
    });

    it("does not collide request and event channel namespaces", () => {
        const requests = new Set(listChannels());
        let collision: string | null = null;
        for (const event of listEventChannels()) {
            if (requests.has(event)) {
                collision = event;
                break;
            }
        }
        expect(collision).toBeNull();
    });

    it("exposes every storage domain channel", () => {
        expect(channels.storage.listProfiles).toBe("storage:listProfiles");
        expect(channels.storage.createProfile).toBe("storage:createProfile");
        expect(channels.storage.renameProfile).toBe("storage:renameProfile");
        expect(channels.storage.deleteProfile).toBe("storage:deleteProfile");
        expect(channels.storage.listPages).toBe("storage:listPages");
        expect(channels.storage.loadPage).toBe("storage:loadPage");
        expect(channels.storage.savePage).toBe("storage:savePage");
        expect(channels.storage.exportProfile).toBe("storage:exportProfile");
        expect(channels.storage.importProfile).toBe("storage:importProfile");
        expect(channels.storage.scanReferences).toBe("storage:scanReferences");
    });

    it("exposes every main-to-renderer event channel", () => {
        expect(eventChannels.usb).toBe("usb:event");
        expect(eventChannels.toast).toBe("app:toast");
        expect(eventChannels.syncProgress).toBe("sync:progress");
        expect(eventChannels.plugin).toBe("plugin:event");
        expect(eventChannels.firmwareState).toBe("firmware:state");
        expect(eventChannels.flashProgress).toBe("flash:progress");
    });

    it("exposes the icon-preview and sync channels", () => {
        expect(channels.icons.preview).toBe("icons:preview");
        expect(channels.sync.reconcile).toBe("sync:reconcile");
        expect(channels.sync.execute).toBe("sync:execute");
    });

    it("exposes settings and the device-delete channels", () => {
        expect(channels.settings.get).toBe("settings:get");
        expect(channels.settings.set).toBe("settings:set");
        expect(channels.settings.revealDataFolder).toBe("settings:revealDataFolder");
        expect(channels.settings.openLogsFolder).toBe("settings:openLogsFolder");
        expect(channels.usb.deleteFile).toBe("usb:deleteFile");
    });

    it("exposes the firmware channels and keeps updater reserved", () => {
        expect(channels.firmware.getState).toBe("firmware:getState");
        expect(channels.firmware.check).toBe("firmware:check");
        expect(channels.firmware.update).toBe("firmware:update");
        expect(channels.firmware.flashLocal).toBe("firmware:flashLocal");
        expect(channels.firmware.cancel).toBe("firmware:cancel");
        expect(channels.updater.state).toBe("updater:state");
        expect(channels.updater.check).toBe("updater:check");
    });
});
