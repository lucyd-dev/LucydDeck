import { describe, expect, it } from "vitest";
import {
    buildActionString,
    filterValidActions,
    isValidActionString,
    parseActionString,
    validateActionString,
} from "./actions";

describe("parseActionString", () => {
    it("splits on the first colon only", () => {
        expect(parseActionString("PAGE:3")).toEqual({ namespace: "PAGE", args: "3" });
        expect(parseActionString("TEXT:hello: world")).toEqual({
            namespace: "TEXT",
            args: "hello: world",
        });
        expect(parseActionString("CMD:echo a:b")).toEqual({
            namespace: "CMD",
            args: "echo a:b",
        });
        expect(parseActionString("TEXT:")).toEqual({ namespace: "TEXT", args: "" });
    });

    it("rejects strings without a usable namespace", () => {
        expect(parseActionString("PAGE")).toBeNull();
        expect(parseActionString(":value")).toBeNull();
        expect(parseActionString("")).toBeNull();
        expect(parseActionString(undefined)).toBeNull();
        expect(parseActionString(42)).toBeNull();
    });
});

describe("buildActionString", () => {
    it("re-joins namespace and args verbatim", () => {
        expect(buildActionString("PAGE", "3")).toBe("PAGE:3");
        expect(buildActionString("TEXT", "a:b")).toBe("TEXT:a:b");
        expect(buildActionString("DELAY", "250")).toBe("DELAY:250");
    });
});

describe("validateActionString — valid grammar examples", () => {
    const valid = [
        "PAGE:0",
        "PAGE:12",
        "PROFILE:main",
        "HID_KEY:A",
        "HID_KEY:CTRL+C",
        "HID_KEY:LEFT_CTRL+LEFT_SHIFT+A",
        "HID_KEY:F5",
        "HID_KEY:KP_1",
        "CONTROL_KEY:VOLUME_UP",
        "CONTROL_KEY:NEXT_PAGE",
        "MOUSE_MOVE:0,0",
        "MOUSE_MOVE:10,-5",
        "MOUSE_MOVE:1,2,3",
        "MOUSE_CLICK:LEFT",
        "MOUSE_CLICK:RIGHT,2",
        "MOUSE_CLICK:MIDDLE,10",
        "DELAY:0",
        "DELAY:250",
        "TEXT:hello world",
        "TEXT:",
        "TEXT:https://example.com/a:b",
        "CMD:explorer.exe",
        "CMD:echo hello:world",
    ];

    it.each(valid)("accepts %s", (action) => {
        expect(validateActionString(action)).toMatchObject({ ok: true });
        expect(isValidActionString(action)).toBe(true);
    });
});

describe("validateActionString — invalid table", () => {
    const invalid: Array<[string, RegExp]> = [
        ["PAGE:-1", /non-negative integer/],
        ["PAGE:abc", /non-negative integer/],
        ["PAGE:", /non-negative integer/],
        ["PAGE:1.5", /non-negative integer/],
        ["PROFILE:", /non-empty/],
        ["PROFILE:   ", /non-empty/],
        ["HID_KEY:", /KEY\[/],
        ["HID_KEY:CTRL+", /KEY\[/],
        ["HID_KEY:NOTAKEY", /Unknown HID key/],
        ["HID_KEY:CTRL+NOPE", /Unknown HID key/],
        ["CONTROL_KEY:", /Unknown control key/],
        ["CONTROL_KEY:NOPE", /Unknown control key/],
        ["MOUSE_MOVE:1", /x,y/],
        ["MOUSE_MOVE:a,b", /x,y/],
        ["MOUSE_MOVE:1,2,3,4", /x,y/],
        ["MOUSE_CLICK:TOP", /button must be/],
        ["MOUSE_CLICK:LEFT,0", /1\.\.10/],
        ["MOUSE_CLICK:LEFT,11", /1\.\.10/],
        ["MOUSE_CLICK:LEFT,x", /1\.\.10/],
        ["MOUSE_CLICK:LEFT,2,3", /BUTTON/],
        ["DELAY:-5", /non-negative integer/],
        ["DELAY:1.5", /non-negative integer/],
        ["CMD:", /non-empty/],
        ["CMD:   ", /non-empty/],
        ["FOO:bar", /Unknown action namespace/],
        ["nocolon", /namespace:args/],
        ["", /namespace:args/],
    ];

    it.each(invalid)("rejects %s with a reason", (action, reason) => {
        const result = validateActionString(action);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(reason);
        expect(isValidActionString(action)).toBe(false);
    });

    it("rejects non-string input", () => {
        expect(validateActionString(null).ok).toBe(false);
        expect(validateActionString(123).ok).toBe(false);
        expect(validateActionString({}).ok).toBe(false);
    });
});

describe("validateActionString — overridable key sets", () => {
    it("accepts custom HID keys and control keys", () => {
        expect(validateActionString("HID_KEY:MYSTERY", { hidKeys: ["MYSTERY"] }).ok).toBe(true);
        expect(validateActionString("CONTROL_KEY:MYSTERY", { controlKeys: ["MYSTERY"] }).ok).toBe(
            true,
        );
        expect(validateActionString("HID_KEY:MYSTERY").ok).toBe(false);
        expect(validateActionString("CONTROL_KEY:MYSTERY").ok).toBe(false);
    });
});

describe("filterValidActions", () => {
    it("keeps valid actions and reports dropped ones", () => {
        const result = filterValidActions([
            "DELAY:100",
            "HID_KEY:CTRL+C",
            "NOPE:x",
            "DELAY:-1",
            "TEXT:ok",
        ]);
        expect(result.actions).toEqual(["DELAY:100", "HID_KEY:CTRL+C", "TEXT:ok"]);
        expect(result.dropped).toHaveLength(2);
        expect(result.dropped[0].value).toBe("NOPE:x");
        expect(result.dropped[1].value).toBe("DELAY:-1");
    });

    it("returns empty results for an empty list", () => {
        expect(filterValidActions([])).toEqual({ actions: [], dropped: [] });
    });
});
