import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_SLOT_ADDRESS } from "@shared/firmware";

const calls = { write: [] as unknown[], reg: [] as number[][] };
const mocks = vi.hoisted(() => {
    const loader = {
        chip: { CHIP_NAME: "ESP32-S3" },
        main: vi.fn(async () => undefined),
        writeFlash: vi.fn(
            async (options: { reportProgress?: (n: number, a: number, b: number) => void }) => {
                calls.write.push(options);
                options.reportProgress?.(0, 0, 100);
                options.reportProgress?.(0, 50, 100);
                options.reportProgress?.(0, 100, 100);
            },
        ),
        writeReg: vi.fn(async (...args: number[]) => {
            calls.reg.push(args);
        }),
    };
    return {
        loader,
        loaderOptions: [] as unknown[],
        transportDisconnect: vi.fn(async () => undefined),
    };
});

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock("esptool-js", () => ({
    ESPLoader: class {
        chip = mocks.loader.chip;
        main = mocks.loader.main;
        writeFlash = mocks.loader.writeFlash;
        writeReg = mocks.loader.writeReg;

        constructor(options: unknown) {
            mocks.loaderOptions.push(options);
        }
    },
    Transport: class {
        constructor() {
            // The transport wraps the adapter; tests only need disconnect.
        }

        disconnect = mocks.transportDisconnect;
    },
}));

import { EsptoolFlasher, FlasherError } from "./EsptoolFlasher";

const PORT = { path: "/dev/ttyACM1" };

describe("EsptoolFlasher", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        calls.write.length = 0;
        calls.reg.length = 0;
        mocks.loader.writeFlash.mockImplementation(async (options) => {
            calls.write.push(options);
            options.reportProgress?.(0, 0, 100);
            options.reportProgress?.(0, 50, 100);
            options.reportProgress?.(0, 100, 100);
        });
    });

    it("writes one app image at 0x10000 without erase-all", async () => {
        const progress: number[] = [];
        const flasher = new EsptoolFlasher({ baudRate: 460800 });

        await flasher.flash(PORT, new Uint8Array([1, 2, 3]), {
            address: APP_SLOT_ADDRESS,
            onProgress: (written, total) => progress.push((written / total) * 100),
        });

        expect(mocks.loader.main).toHaveBeenCalledWith("no_reset");
        expect(mocks.loader.writeFlash).toHaveBeenCalledTimes(1);
        const options = calls.write[0] as {
            fileArray: Array<{ address: number; data: Uint8Array }>;
            eraseAll: boolean;
            compress: boolean;
            flashMode: string;
            flashFreq: string;
            flashSize: string;
        };
        expect(options.fileArray).toEqual([
            { data: new Uint8Array([1, 2, 3]), address: APP_SLOT_ADDRESS },
        ]);
        expect(options.eraseAll).toBe(false);
        expect(options.flashMode).toBe("keep");
        expect(options.flashFreq).toBe("keep");
        expect(options.flashSize).toBe("keep");
        expect(progress).toEqual([0, 50, 100]);
    });

    it("clears the force-download flag and restarts through the RTC watchdog", async () => {
        const flasher = new EsptoolFlasher();
        await flasher.flash(PORT, new Uint8Array([1]), {
            address: APP_SLOT_ADDRESS,
            onProgress: () => undefined,
        });

        const addresses = calls.reg.map((args) => args[0]);
        expect(addresses).toContain(0x6000812c);
        expect(addresses).toContain(0x600080b0);
        expect(mocks.loader.writeReg).toHaveBeenCalledWith(0x6000812c, 0, 0x1);
    });

    it("refuses an address outside the app slot before touching the deck", async () => {
        const flasher = new EsptoolFlasher();
        await expect(
            flasher.flash(PORT, new Uint8Array([1]), {
                address: 0x20000,
                onProgress: () => undefined,
            }),
        ).rejects.toBeInstanceOf(FlasherError);
        expect(mocks.loader.main).not.toHaveBeenCalled();
        expect(mocks.loader.writeFlash).not.toHaveBeenCalled();
    });

    it("refuses a deck that is not an ESP32-S3", async () => {
        mocks.loader.chip.CHIP_NAME = "ESP32-C3";
        try {
            const flasher = new EsptoolFlasher();
            await expect(
                flasher.flash(PORT, new Uint8Array([1]), {
                    address: APP_SLOT_ADDRESS,
                    onProgress: () => undefined,
                }),
            ).rejects.toThrow("ESP32-C3");
        } finally {
            mocks.loader.chip.CHIP_NAME = "ESP32-S3";
        }
    });
});
