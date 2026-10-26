import { describe, expect, it } from "vitest";
import {
    APP_SLOT_SIZE,
    idleFirmwareState,
    isFirmwareActive,
    isFirmwareBusy,
    validateFlashSize,
} from "./firmware";

describe("validateFlashSize", () => {
    it("accepts an app image inside the slot", () => {
        expect(validateFlashSize(1234)).toEqual({ ok: true });
    });

    it("accepts exactly 8064 KiB and refuses one byte more", () => {
        expect(APP_SLOT_SIZE).toBe(8064 * 1024);
        expect(validateFlashSize(APP_SLOT_SIZE)).toEqual({ ok: true });
        expect(validateFlashSize(APP_SLOT_SIZE + 1)).toMatchObject({
            ok: false,
            reason: "size",
        });
    });

    it("refuses an empty image", () => {
        expect(validateFlashSize(0)).toMatchObject({ ok: false, reason: "empty" });
    });
});

describe("isFirmwareBusy", () => {
    it("covers every phase that owns the deck", () => {
        expect(isFirmwareBusy("handoff")).toBe(true);
        expect(isFirmwareBusy("locating")).toBe(true);
        expect(isFirmwareBusy("writing")).toBe(true);
        expect(isFirmwareBusy("returning")).toBe(true);
        expect(isFirmwareBusy("ready")).toBe(false);
        expect(isFirmwareBusy("done")).toBe(false);
        expect(isFirmwareBusy("error")).toBe(false);
    });
});

describe("isFirmwareActive", () => {
    it("counts a check and a download as active but not as a flash", () => {
        expect(isFirmwareActive(idleFirmwareState())).toBe(false);
        expect(
            isFirmwareActive({
                ...idleFirmwareState(),
                release: {
                    status: "checking",
                    latest: null,
                    error: null,
                },
            }),
        ).toBe(true);
        expect(
            isFirmwareActive({
                ...idleFirmwareState(),
                phase: "downloading",
            }),
        ).toBe(true);
        expect(
            isFirmwareActive({
                ...idleFirmwareState(),
                phase: "writing",
            }),
        ).toBe(true);
    });
});

describe("idleFirmwareState", () => {
    it("starts with nothing selected, no deck reading and no release", () => {
        expect(idleFirmwareState()).toEqual({
            phase: "idle",
            installedVersion: null,
            board: null,
            image: null,
            error: null,
            release: {
                status: "idle",
                latest: null,
                error: null,
            },
        });
    });
});
