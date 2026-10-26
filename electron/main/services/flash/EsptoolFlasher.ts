// ---------------------------------------------------------------------------
// esptool-js behind a tiny seam: one app image, one address, no erase-all.
// ---------------------------------------------------------------------------

import log from "electron-log/main";
import { ESPLoader, Transport } from "esptool-js";
import { APP_SLOT_ADDRESS } from "@shared/firmware";
import type { SerialPortInfoLike } from "./PortFingerprint";
import { SerialPortAdapter } from "./SerialPortAdapter";

/** ESP32-S3 RTC control block; esptool's S3 target uses the same addresses. */
const RTC_CNTL_BASE = 0x60008000;
const RTC_CNTL_OPTION1_REG = 0x6000812c;
const RTC_CNTL_FORCE_DOWNLOAD_BOOT_MASK = 0x1;
const RTC_CNTL_WDTWPROTECT_REG = RTC_CNTL_BASE + 0xb0;
const RTC_CNTL_WDTCONFIG1_REG = RTC_CNTL_BASE + 0x9c;
const RTC_CNTL_WDTCONFIG0_REG = RTC_CNTL_BASE + 0x98;
const RTC_CNTL_WDT_WKEY = 0x50d83aa1;

/**
 * Restart the deck into the app.
 *
 * `CMD_ENTER_BOOTLOADER` sets the S3's force-download-boot flag, which survives
 * a reset, so the flag is cleared first. The ROM loader's serial control lines
 * are not available on every transport (WSL's USB/IP `cdc_acm` rejects them),
 * so a hard reset via RTS is not enough: arm the RTC watchdog, which resets the
 * chip and boots the newly written app. This mirrors esptool.py's ESP32-S3
 * `hard_reset`.
 */
async function resetToApp(loader: ESPLoader): Promise<void> {
    try {
        await loader.writeReg(RTC_CNTL_OPTION1_REG, 0, RTC_CNTL_FORCE_DOWNLOAD_BOOT_MASK);
    } catch (error) {
        log.warn(`[flash] could not clear force-download boot: ${String(error)}`);
    }
    try {
        await loader.writeReg(RTC_CNTL_WDTWPROTECT_REG, RTC_CNTL_WDT_WKEY);
        await loader.writeReg(RTC_CNTL_WDTCONFIG1_REG, 5000);
        await loader.writeReg(RTC_CNTL_WDTCONFIG0_REG, (1 << 31) | (5 << 28) | (1 << 8) | 2);
        await loader.writeReg(RTC_CNTL_WDTWPROTECT_REG, 0);
        log.info("[flash] armed the RTC watchdog to restart the deck");
    } catch (error) {
        // The chip may reset before the last write is acknowledged.
        log.info(`[flash] RTC watchdog reset finished: ${String(error)}`);
    }
}

/** esptool's serial console, routed to the app log instead of the UI. */
const terminal = {
    clean(): void {
        // Nothing to clean in a log file.
    },
    write(text: string): void {
        log.debug(`[flash] ${text}`);
    },
    writeLine(text: string): void {
        log.info(`[flash] ${text}`);
    },
};

export interface FlashImageOptions {
    /** Address inside the app slot; the caller has already validated it. */
    address: number;
    /** Called for every written block, with bytes written and the image total. */
    onProgress: (written: number, total: number) => void;
}

/** The one seam `FirmwareService` uses to write a deck. */
export interface FirmwareFlasher {
    flash(port: SerialPortInfoLike, image: Uint8Array, options: FlashImageOptions): Promise<void>;
}

export class FlasherError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FlasherError";
    }
}

export interface EsptoolFlasherOptions {
    /** Loader baud rate. Kept modest for the virtual USB hop in WSL. */
    baudRate?: number;
    /** Test seam: build the Web Serial adapter for a port. */
    createAdapter?: (port: SerialPortInfoLike) => SerialPortAdapter;
}

/**
 * Write only the app image at `0x10000`, with `eraseAll: false`.
 *
 * The deck enters the ROM bootloader from `CMD_ENTER_BOOTLOADER`; esptool then
 * syncs without a DTR/RTS reset, uploads the flasher stub and writes the app
 * slot. Nothing here writes the bootloader, partition table or NVS.
 */
export class EsptoolFlasher implements FirmwareFlasher {
    private readonly baudRate: number;
    private readonly createAdapter: (port: SerialPortInfoLike) => SerialPortAdapter;

    constructor(options: EsptoolFlasherOptions = {}) {
        this.baudRate = options.baudRate ?? 460800;
        this.createAdapter = options.createAdapter ?? ((port) => new SerialPortAdapter(port.path));
    }

    async flash(
        port: SerialPortInfoLike,
        image: Uint8Array,
        options: FlashImageOptions,
    ): Promise<void> {
        if (options.address !== APP_SLOT_ADDRESS) {
            throw new FlasherError(
                `Refusing to write at 0x${options.address.toString(16)}; the app slot is 0x${APP_SLOT_ADDRESS.toString(16)}`,
            );
        }
        const adapter = this.createAdapter(port);
        const transport = new Transport(
            adapter as unknown as ConstructorParameters<typeof Transport>[0],
            false,
            true,
        );
        const loader = new ESPLoader({
            transport,
            baudrate: this.baudRate,
            romBaudrate: 115200,
            terminal,
        });

        try {
            log.info(`[flash] connecting to ${port.path}`);
            await loader.main("no_reset");
            const chip = loader.chip.CHIP_NAME;
            if (chip !== "ESP32-S3") {
                throw new FlasherError(`The deck reported ${chip}, not ESP32-S3`);
            }
            log.info(`[flash] writing ${image.length} bytes at 0x${options.address.toString(16)}`);
            await loader.writeFlash({
                fileArray: [{ data: image, address: options.address }],
                flashMode: "keep",
                flashFreq: "keep",
                flashSize: "keep",
                eraseAll: false,
                compress: true,
                reportProgress: (_fileIndex, written, total) => {
                    options.onProgress(written, total);
                },
            });
            try {
                // The chip drops off USB as it resets; closing the port after
                // that can report an error even though the restart worked.
                await resetToApp(loader);
            } catch (error) {
                log.warn(`[flash] reset after write reported: ${String(error)}`);
            }
        } finally {
            try {
                await transport.disconnect();
            } catch (error) {
                log.warn(`[flash] could not close ${port.path}: ${String(error)}`);
                await adapter.close().catch(() => undefined);
            }
        }
    }
}
