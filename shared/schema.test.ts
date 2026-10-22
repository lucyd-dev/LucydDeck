import { describe, expect, it } from "vitest";
import {
    BOARD_COLS,
    BOARD_ROWS,
    BOARD_SIZE,
    boardIndexToKey,
    emptyButtonConfig,
    emptyPageConfig,
    isValidBoardIndex,
    serializePageConfig,
    validatePageConfig,
} from "./schema";

describe("board geometry", () => {
    it("is 3 rows x 5 columns = 15 keys", () => {
        expect(BOARD_ROWS).toBe(3);
        expect(BOARD_COLS).toBe(5);
        expect(BOARD_SIZE).toBe(15);
    });

    it("accepts canonical indices 0..14 only", () => {
        for (let index = 0; index < BOARD_SIZE; index++) {
            expect(isValidBoardIndex(boardIndexToKey(index))).toBe(true);
        }
        for (const key of ["00", "01", "15", "99", "-1", "a", "", "1.5"]) {
            expect(isValidBoardIndex(key)).toBe(false);
        }
    });
});

describe("validatePageConfig", () => {
    it("accepts a valid page and keeps canonical keys", () => {
        const result = validatePageConfig({
            buttons: {
                "0": {
                    imageName: "github.png",
                    backgroundColor: "#1c2129",
                    label: "Launch",
                    click: ["CMD:explorer.exe", "DELAY:100"],
                },
                "14": { label: "Last", click: [] },
            },
        });
        expect(result.ok).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.page.buttons["0"]).toEqual({
            imageName: "github",
            backgroundColor: "#1c2129",
            label: "Launch",
            click: ["CMD:explorer.exe", "DELAY:100"],
        });
        expect(result.page.buttons["14"]).toEqual({
            label: "Last",
            click: [],
        });
    });

    it("omits empty buttons (absent key = empty slot)", () => {
        const result = validatePageConfig({
            buttons: {
                "0": { click: [] },
                "1": { imageName: "", backgroundColor: "", label: "" },
            },
        });
        expect(result.ok).toBe(true);
        expect(result.page.buttons).toEqual({});
    });

    it("rejects non-canonical keys as fatal but keeps the rest", () => {
        const result = validatePageConfig({
            buttons: {
                "0": { label: "ok", click: [] },
                "00": { label: "bad", click: [] },
                "15": { label: "out of range", click: [] },
                "-1": { label: "negative", click: [] },
            },
        });
        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(3);
        expect(Object.keys(result.page.buttons)).toEqual(["0"]);
    });

    it("drops invalid actions but does not fail validation", () => {
        const result = validatePageConfig({
            buttons: {
                "3": { click: ["DELAY:100", "NOPE:x", "PAGE:-1"] },
            },
        });
        expect(result.ok).toBe(true);
        expect(result.page.buttons["3"].click).toEqual(["DELAY:100"]);
        expect(result.errors).toHaveLength(2);
    });

    it("rejects structurally invalid pages", () => {
        expect(validatePageConfig(null).ok).toBe(false);
        expect(validatePageConfig([]).ok).toBe(false);
        expect(validatePageConfig({}).ok).toBe(false);
        expect(validatePageConfig({ buttons: "nope" }).ok).toBe(false);
        expect(validatePageConfig({ buttons: [] }).ok).toBe(false);
        expect(validatePageConfig({ buttons: { "0": 42 } }).ok).toBe(false);
    });

    it("flags non-string field values", () => {
        const result = validatePageConfig({
            buttons: { "0": { imageName: 7, backgroundColor: 1, label: {}, click: [] } },
        });
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
});

describe("serializePageConfig", () => {
    it("sorts keys ascending and strips invalid actions", () => {
        const serialized = serializePageConfig({
            buttons: {
                "12": { label: "b", click: ["NOPE:x"] },
                "2": { label: "a", click: ["DELAY:5"] },
                "00": { label: "bad", click: [] },
            },
        });
        expect(Object.keys(serialized.buttons)).toEqual(["2", "12"]);
        expect(serialized.buttons["12"].click).toEqual([]);
        expect(serialized.buttons["2"].click).toEqual(["DELAY:5"]);
    });

    it("returns an empty page for structurally invalid input", () => {
        expect(serializePageConfig(null as never)).toEqual({ buttons: {} });
    });
});

describe("factories", () => {
    it("produces fresh empty configs", () => {
        expect(emptyPageConfig()).toEqual({ buttons: {} });
        expect(emptyButtonConfig()).toEqual({ click: [] });
        expect(emptyButtonConfig()).not.toBe(emptyButtonConfig());
    });
});
