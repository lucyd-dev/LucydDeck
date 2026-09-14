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
    });

    it("exposes every main-to-renderer event channel", () => {
        expect(eventChannels.usb).toBe("usb:event");
        expect(eventChannels.toast).toBe("app:toast");
        expect(eventChannels.syncProgress).toBe("sync:progress");
        expect(eventChannels.plugin).toBe("plugin:event");
        expect(eventChannels.firmwareState).toBe("firmware:state");
        expect(eventChannels.flashProgress).toBe("flash:progress");
    });
});
