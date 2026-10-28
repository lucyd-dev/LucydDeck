import { describe, expect, it } from "vitest";
import {
    ENTITY_NAME_MAX_BYTES,
    isEntityName,
    isPathSafeName,
    resolveEntityName,
    sanitizeEntityName,
    type EntityNameMode,
    type NameReason,
    type NameResult,
} from "./names";

describe("isEntityName", () => {
    it("accepts the firmware's entity-name set", () => {
        expect(isEntityName("Gaming Room")).toBe(true);
        expect(isEntityName("v12")).toBe(true);
        expect(isEntityName("github_icons-2")).toBe(true);
        expect(isEntityName("a".repeat(ENTITY_NAME_MAX_BYTES))).toBe(true);
    });

    it("matches the firmware's byte and edge-space limits", () => {
        expect(isEntityName("")).toBe(false);
        expect(isEntityName("a".repeat(ENTITY_NAME_MAX_BYTES + 1))).toBe(false);
        expect(isEntityName(` ${"a".repeat(ENTITY_NAME_MAX_BYTES - 1)}`)).toBe(false);
        expect(isEntityName(`${"a".repeat(ENTITY_NAME_MAX_BYTES - 1)} `)).toBe(false);
        expect(isEntityName("   ")).toBe(false);
    });

    it("rejects characters outside the firmware set without changing them", () => {
        for (const name of [
            "Gaming: Room",
            "v1.2",
            "logo.png",
            "a/b",
            "a\\b",
            "café",
            "emoji 🎨",
            "tab\there",
            "dot.",
        ]) {
            expect(isEntityName(name)).toBe(false);
        }
    });
});

describe("sanitizeEntityName", () => {
    it("trims leading and trailing spaces", () => {
        expect(sanitizeEntityName(" Gaming ")).toBe("Gaming");
        expect(sanitizeEntityName("\tGaming Room\n")).toBe("Gaming Room");
    });

    it("strips a trailing .png, case-insensitively and repeatedly", () => {
        expect(sanitizeEntityName("logo.png")).toBe("logo");
        expect(sanitizeEntityName("logo.PNG")).toBe("logo");
        expect(sanitizeEntityName("logo.png.png")).toBe("logo");
        expect(sanitizeEntityName("logo.png ")).toBe("logo");
    });

    it("drops bytes outside the firmware set", () => {
        expect(sanitizeEntityName("v1.2")).toBe("v12");
        expect(sanitizeEntityName("Gaming: Room")).toBe("Gaming Room");
        expect(sanitizeEntityName("café")).toBe("caf");
        expect(sanitizeEntityName("a/b")).toBe("ab");
    });

    it("collapses repeated spaces left by dropped characters", () => {
        expect(sanitizeEntityName("Gaming  :  Room")).toBe("Gaming Room");
        expect(sanitizeEntityName("a\t \tb")).toBe("a b");
    });

    it("clamps to 64 bytes without leaving a trailing space", () => {
        expect(sanitizeEntityName("a".repeat(70))).toBe("a".repeat(ENTITY_NAME_MAX_BYTES));
        expect(sanitizeEntityName(`${"a".repeat(ENTITY_NAME_MAX_BYTES - 1)} b`)).toBe(
            "a".repeat(ENTITY_NAME_MAX_BYTES - 1),
        );
    });

    it("leaves a valid name unchanged", () => {
        for (const name of ["Gaming Room", "v12", "github_icons-2", "a".repeat(64)]) {
            expect(sanitizeEntityName(name)).toBe(name);
        }
    });

    it("returns an empty name when nothing usable survives", () => {
        expect(sanitizeEntityName("")).toBe("");
        expect(sanitizeEntityName("...")).toBe("");
        expect(sanitizeEntityName("🎨")).toBe("");
        expect(sanitizeEntityName(".png")).toBe("");
    });

    it("returns only names the firmware will accept", () => {
        for (const input of [
            " Gaming ",
            "v1.2",
            "Gaming: Room",
            "logo.png",
            "a".repeat(70),
            `${"a".repeat(63)} b`,
            "café",
            "..",
        ]) {
            const sanitized = sanitizeEntityName(input);
            if (sanitized !== "") {
                expect(isEntityName(sanitized)).toBe(true);
            }
        }
    });
});

describe("isPathSafeName", () => {
    it("rejects empty, dot, and dotdot names", () => {
        expect(isPathSafeName("")).toBe(false);
        expect(isPathSafeName(".")).toBe(false);
        expect(isPathSafeName("..")).toBe(false);
    });

    it("rejects path separators and control characters", () => {
        expect(isPathSafeName("a/b")).toBe(false);
        expect(isPathSafeName("a\\b")).toBe(false);
        expect(isPathSafeName("a\nb")).toBe(false);
        expect(isPathSafeName("a\tb")).toBe(false);
        expect(isPathSafeName("a\u0000b")).toBe(false);
        expect(isPathSafeName("a\u007fb")).toBe(false);
    });

    it("rejects Windows-reserved device names and trailing dots/spaces", () => {
        expect(isPathSafeName("CON")).toBe(false);
        expect(isPathSafeName("con")).toBe(false);
        expect(isPathSafeName("NUL")).toBe(false);
        expect(isPathSafeName("AUX")).toBe(false);
        expect(isPathSafeName("COM1")).toBe(false);
        expect(isPathSafeName("COM9")).toBe(false);
        expect(isPathSafeName("LPT1")).toBe(false);
        expect(isPathSafeName("main.")).toBe(false);
        expect(isPathSafeName("main ")).toBe(false);
        expect(isPathSafeName("main .")).toBe(false);
    });

    it("accepts a normal name that merely starts like a reserved one", () => {
        // Only COM1..COM9 are reserved; COM10 is an ordinary name.
        // Reserved names remain reserved when followed by an extension/dot.
        expect(isPathSafeName("COM10")).toBe(true);
        expect(isPathSafeName("con.fig")).toBe(false);
    });

    it("accepts names from before the entity grammar", () => {
        expect(isPathSafeName("main")).toBe(true);
        expect(isPathSafeName("Space Cadet")).toBe(true);
        expect(isPathSafeName("42")).toBe(true);
        expect(isPathSafeName("v1.2")).toBe(true);
        expect(isPathSafeName("Gaming: Room")).toBe(true);
        expect(isPathSafeName("logo.png")).toBe(true);
        expect(isPathSafeName("a".repeat(ENTITY_NAME_MAX_BYTES + 1))).toBe(true);
    });
});

type NameCase = [input: string, mode: EntityNameMode, expected: NameResult];

function expectNameCases(cases: NameCase[]): void {
    for (const [input, mode, expected] of cases) {
        expect(resolveEntityName(input, mode), `${mode} ${JSON.stringify(input)}`).toEqual(
            expected,
        );
    }
}

function refused(reason: NameReason): NameResult {
    return { ok: false, reason };
}

describe("resolveEntityName", () => {
    it("sanitises a new name, then applies the grammar and path safety", () => {
        expectNameCases([
            [" Gaming ", "new", { ok: true, name: "Gaming" }],
            ["v1.2", "new", { ok: true, name: "v12" }],
            ["Gaming: Room", "new", { ok: true, name: "Gaming Room" }],
            ["logo.png", "new", { ok: true, name: "logo" }],
            ["a".repeat(70), "new", { ok: true, name: "a".repeat(ENTITY_NAME_MAX_BYTES) }],
            ["", "new", refused("empty")],
            ["...", "new", refused("empty")],
            ["🎨", "new", refused("empty")],
            ["CON", "new", refused("reserved")],
            ["con", "new", refused("reserved")],
            ["NUL", "new", refused("reserved")],
        ]);
    });

    it("leaves an existing name untouched and checks path safety only", () => {
        expectNameCases([
            ["v1.2", "existing", { ok: true, name: "v1.2" }],
            ["Gaming: Room", "existing", { ok: true, name: "Gaming: Room" }],
            ["logo.png", "existing", { ok: true, name: "logo.png" }],
            ["Space Cadet", "existing", { ok: true, name: "Space Cadet" }],
            [
                "a".repeat(ENTITY_NAME_MAX_BYTES + 1),
                "existing",
                { ok: true, name: "a".repeat(ENTITY_NAME_MAX_BYTES + 1) },
            ],
            ["", "existing", refused("empty")],
            [".", "existing", refused("path")],
            ["..", "existing", refused("path")],
            ["a/b", "existing", refused("path")],
            ["a\\b", "existing", refused("path")],
            ["a\nb", "existing", refused("path")],
            ["main.", "existing", refused("path")],
            ["main ", "existing", refused("path")],
            ["CON", "existing", refused("reserved")],
            ["con.fig", "existing", refused("reserved")],
        ]);
    });

    it("returns only paths the filesystem can address", () => {
        for (const [input, mode] of [
            ["con.fig", "new"],
            ["a/b", "new"],
            ["..", "new"],
            ["v1.2", "existing"],
            ["Gaming: Room", "existing"],
            ["logo.png", "existing"],
        ] as Array<[string, EntityNameMode]>) {
            const result = resolveEntityName(input, mode);
            if (result.ok) {
                expect(isPathSafeName(result.name), `${mode} ${input}`).toBe(true);
            }
        }
    });
});
