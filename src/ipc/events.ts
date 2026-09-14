import { eventChannels } from "@shared/ipc";
import type { EventChannel, EventPayloadFor } from "@shared/ipc";

/**
 * Typed event subscription over `window.lucyd`. `on` returns an id that is
 * passed to `off` to unsubscribe (the preload keeps the callback registry).
 */
export function on<E extends EventChannel>(
    channel: E,
    handler: (payload: EventPayloadFor<E>) => void,
): number {
    return window.lucyd.on(channel, handler);
}

export function off<E extends EventChannel>(channel: E, id: number): void {
    window.lucyd.off(channel, id);
}

export { eventChannels };
