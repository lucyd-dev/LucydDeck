// ---------------------------------------------------------------------------
// Thin abstraction over `node-hid` so `UsbService` is unit-testable with a
// fake transport. The real implementation is the only place that imports the
// native module.
// ---------------------------------------------------------------------------

import * as nodeHid from "node-hid";

/** Subset of a node-hid device descriptor the matcher needs. */
export interface HidDeviceDescriptor {
    path?: string;
    vendorId: number;
    productId: number;
    usagePage?: number;
    usage?: number;
    product?: string;
    manufacturer?: string;
    serialNumber?: string;
}

/** An open HID connection. Reports are 64-byte buffers (report ID included). */
export interface HidConnection {
    write(report: Uint8Array): Promise<void>;
    close(): Promise<void>;
    onData(listener: (report: Uint8Array) => void): void;
    onError(listener: (error: Error) => void): void;
}

export interface HidTransport {
    list(): Promise<HidDeviceDescriptor[]>;
    open(path: string): Promise<HidConnection>;
}

/** Production transport backed by node-hid's `HIDAsync`. */
export const nodeHidTransport: HidTransport = {
    async list(): Promise<HidDeviceDescriptor[]> {
        return nodeHid.devicesAsync();
    },

    async open(path: string): Promise<HidConnection> {
        const device = await nodeHid.HIDAsync.open(path);
        return {
            async write(report: Uint8Array): Promise<void> {
                await device.write(Buffer.from(report));
            },
            close: () => device.close(),
            onData(listener) {
                device.on("data", (data: Buffer) => listener(new Uint8Array(data)));
            },
            onError(listener) {
                device.on("error", (error: Error) => listener(error));
            },
        };
    },
};
