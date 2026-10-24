import { describe, expect, it } from "vitest";
import { describeStep, formatStep, parseStep, stepCategory, stepValues } from "./actionSteps";

describe("parseStep and formatStep", () => {
    const actions = [
        "PAGE:0",
        "PAGE:12",
        "PROFILE:main",
        "HID_KEY:CTRL+C",
        "HID_KEY:LEFT_CTRL+LEFT_SHIFT+A",
        "CONTROL_KEY:VOLUME_UP",
        "MOUSE_MOVE:10,-5",
        "MOUSE_MOVE:1,2,3",
        "MOUSE_CLICK:LEFT",
        "MOUSE_CLICK:RIGHT,2",
        "DELAY:250",
        "TEXT:hello: world",
        "CMD:explorer.exe",
        "CMD:obs:start_recording",
    ];

    it.each(actions)("round-trips %s", (raw) => {
        const step = parseStep(raw);
        expect(step).not.toBeNull();
        expect(formatStep(step!)).toBe(raw);
    });

    it("splits only on the first colon and keeps the raw text", () => {
        expect(parseStep("TEXT:a:b")).toEqual({
            namespace: "TEXT",
            args: "a:b",
            raw: "TEXT:a:b",
        });
    });

    it("returns null when the string has no usable namespace", () => {
        expect(parseStep("nocolon")).toBeNull();
        expect(parseStep(":value")).toBeNull();
        expect(parseStep("")).toBeNull();
    });
});

describe("describeStep", () => {
    it("describes every namespace in human language", () => {
        expect(describeStep("PAGE:2")).toMatchObject({
            label: "Switch to page 3",
            category: "deck",
        });
        expect(describeStep("PROFILE:work")).toMatchObject({ label: "Switch to profile work" });
        expect(describeStep("HID_KEY:CTRL+C")).toMatchObject({ label: "Press Ctrl + C" });
        expect(describeStep("CONTROL_KEY:VOLUME_UP")).toMatchObject({ label: "Volume up" });
        expect(describeStep("MOUSE_MOVE:10,-5")).toMatchObject({
            label: "Move cursor",
            detail: "to 10, -5",
        });
        expect(describeStep("MOUSE_CLICK:LEFT,2")).toMatchObject({ label: "Double-click" });
        expect(describeStep("DELAY:250")).toMatchObject({ label: "Wait 250 ms" });
        expect(describeStep("TEXT:Hello")).toMatchObject({ label: "Type “Hello”" });
        expect(describeStep("CMD:obs:start_recording")).toMatchObject({
            label: "Run obs · start recording",
            category: "plugins",
        });
        expect(describeStep("CMD:gnome-calculator")).toMatchObject({
            label: "Run command",
            detail: "gnome-calculator",
            category: "commands",
        });
    });

    it("explains an invalid step and keeps the raw text available", () => {
        const described = describeStep("HID_KEY:CTRL+NOPE");
        expect(described.label).toBe("Invalid step");
        expect(described.detail).toMatch(/Unknown HID key/);
        expect(described.invalid).toMatch(/Unknown HID key/);
        expect(describeStep("nocolon")).toMatchObject({
            label: "Invalid step",
            invalid: 'Expected "namespace:args"',
        });
    });

    it("keeps labels short", () => {
        const longText = "x".repeat(200);
        for (const raw of [
            `TEXT:${longText}`,
            `PROFILE:${longText}`,
            `CMD:${longText}`,
            `HID_KEY:${Array.from({ length: 12 }, () => "LEFT_CTRL").join("+")}`,
        ]) {
            expect(describeStep(raw).label.length).toBeLessThanOrEqual(48);
        }
    });
});

describe("stepValues", () => {
    it("maps a parsed step onto the picker field names", () => {
        expect(stepValues(parseStep("MOUSE_CLICK:RIGHT,2")!)).toEqual({
            button: "RIGHT",
            count: "2",
        });
        expect(stepValues(parseStep("MOUSE_MOVE:1,2")!)).toEqual({
            x: "1",
            y: "2",
            wheel: "",
        });
        expect(stepValues(parseStep("TEXT:hello")!)).toEqual({ text: "hello" });
        expect(stepValues(parseStep("HID_KEY:CTRL+C")!)).toEqual({ keys: "CTRL+C" });
        expect(stepValues(parseStep("CMD:obs:go")!)).toEqual({ command: "obs:go" });
    });

    it("returns null for a malformed step", () => {
        expect(stepValues(parseStep("HID_KEY:CTRL+NOPE")!)).toBeNull();
    });
});

describe("stepCategory", () => {
    it("groups namespaces into the same categories the panel shows", () => {
        expect(stepCategory("PAGE")).toBe("deck");
        expect(stepCategory("PROFILE")).toBe("deck");
        expect(stepCategory("HID_KEY")).toBe("keyboard");
        expect(stepCategory("CONTROL_KEY")).toBe("keyboard");
        expect(stepCategory("MOUSE_MOVE")).toBe("mouse");
        expect(stepCategory("MOUSE_CLICK")).toBe("mouse");
        expect(stepCategory("TEXT")).toBe("text");
        expect(stepCategory("DELAY")).toBe("timing");
        expect(stepCategory("CMD")).toBe("commands");
        expect(stepCategory("UNKNOWN")).toBe("commands");
    });
});
