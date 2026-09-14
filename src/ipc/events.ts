import { eventChannels } from "@shared/ipc";
import type { EventChannel, EventPayloadFor } from "@shared/ipc";

/**
 * Typed event subscription over `window.lucyd`. `on` returns an id that is
 * passed to `window.lucyd.off` to unsubscribe (the preload keeps the
 * callback registry). Renderer stores keep the subscription for the app
 * lifetime, so `unsubscribe` is currently unused — kept for Step 2+
 * consumers (usb status, sync progress) that need scoped listeners.
 */
export function on<E extends EventChannel>(
    channel: E,
    handler: (payload: EventPayloadFor<E>) => void,
): number {
    return window.lucyd.on(channel, handler);
}

export { eventChannels };
