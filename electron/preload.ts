import { contextBridge, ipcRenderer } from "electron";

// The renderer never touches `ipcRenderer` directly. Everything goes through
// the typed `window.lucyd` bridge declared in `src/vite-env.d.ts` (type-level
// contract in `shared/ipc.ts`).

type Listener = (payload: unknown) => void;

// contextBridge flattens callbacks into stateless proxies, so we keep a
// registry here keyed by (channel -> id) and forward ipcRenderer events to
// the renderer's callbacks. `on` returns an id that `off` accepts.
const subscriptions = new Map<string, Map<number, Listener>>();
let nextSubscriptionId = 0;

contextBridge.exposeInMainWorld("lucyd", {
    invoke(channel: string, payload?: unknown) {
        return ipcRenderer.invoke(channel, payload);
    },

    on(channel: string, handler: Listener) {
        if (!subscriptions.has(channel)) {
            subscriptions.set(channel, new Map());
            ipcRenderer.on(channel, (event, payload) => {
                void event;
                const forChannel = subscriptions.get(channel);
                if (!forChannel) {
                    return;
                }
                for (const listener of forChannel.values()) {
                    listener(payload);
                }
            });
        }
        const id = ++nextSubscriptionId;
        subscriptions.get(channel)!.set(id, handler);
        return id;
    },

    off(channel: string, id: number) {
        const forChannel = subscriptions.get(channel);
        if (!forChannel) {
            return;
        }
        forChannel.delete(id);
        if (forChannel.size === 0) {
            subscriptions.delete(channel);
            ipcRenderer.removeAllListeners(channel);
        }
    },
});
