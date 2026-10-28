import { describe, expect, it } from "vitest";
import { PAYLOAD_MAX } from "./protocol";
import { iconIdentity, pageIdentity, profileIdentity, profileRenameIdentity } from "./identity";

/** A page identity's wire length: `<profile>/<id>`. */
function pageLength(profile: string, id: string): number {
    return new TextEncoder().encode(`${profile}/${id}`).length;
}

describe("pageIdentity", () => {
    it("builds `<profile>/<id>` and keeps the parts", () => {
        expect(pageIdentity("gaming", 3)).toEqual({
            ok: true,
            identity: { kind: "page", profile: "gaming", pageId: "3", identity: "gaming/3" },
        });
        expect(pageIdentity("Gaming Room", "42")).toEqual({
            ok: true,
            identity: {
                kind: "page",
                profile: "Gaming Room",
                pageId: "42",
                identity: "Gaming Room/42",
            },
        });
    });

    it("refuses a page id outside 0..255", () => {
        for (const id of ["300", "x", "-1", "1.0", " 3"]) {
            expect(pageIdentity("gaming", id)).toEqual({
                ok: false,
                reason: "page-id",
                identity: `gaming/${id}`,
            });
        }
    });

    it("refuses an empty half", () => {
        expect(pageIdentity("", 3)).toEqual({ ok: false, reason: "empty", identity: "/3" });
        expect(pageIdentity("gaming", "")).toEqual({
            ok: false,
            reason: "empty",
            identity: "gaming/",
        });
    });

    it("fills a command frame exactly and refuses one byte more", () => {
        const profile = "p".repeat(PAYLOAD_MAX - 2);
        expect(pageLength(profile, "3")).toBe(PAYLOAD_MAX);
        expect(pageIdentity(profile, 3).ok).toBe(true);

        const longer = "p".repeat(PAYLOAD_MAX - 1);
        expect(pageLength(longer, "3")).toBe(PAYLOAD_MAX + 1);
        expect(pageIdentity(longer, 3)).toEqual({
            ok: false,
            reason: "too-long",
            identity: `${longer}/3`,
        });
    });

    it("reserves the target byte in a transfer start payload", () => {
        const exact = "p".repeat(PAYLOAD_MAX - 2);
        expect(pageLength(exact, "3")).toBe(PAYLOAD_MAX);
        expect(pageIdentity(exact, 3).ok).toBe(true);
        expect(pageIdentity(exact, 3, "transfer")).toEqual({
            ok: false,
            reason: "too-long",
            identity: `${exact}/3`,
        });

        const fits = "p".repeat(PAYLOAD_MAX - 3);
        expect(pageLength(fits, "3")).toBe(PAYLOAD_MAX - 1);
        expect(pageIdentity(fits, 3, "transfer").ok).toBe(true);
    });

    it("measures the limit in UTF-8 bytes, not code units", () => {
        // Two bytes per `é`, so 60 bytes fit a command but not a transfer.
        const profile = "é".repeat(29);
        expect(pageIdentity(profile, 3).ok).toBe(true);
        expect(pageIdentity(profile, 3, "transfer")).toEqual({
            ok: false,
            reason: "too-long",
            identity: `${profile}/3`,
        });
    });
});

describe("iconIdentity", () => {
    it("uses the bare base name", () => {
        expect(iconIdentity("github")).toEqual({
            ok: true,
            identity: { kind: "icon", name: "github", identity: "github" },
        });
    });

    it("refuses an empty name", () => {
        expect(iconIdentity("")).toEqual({ ok: false, reason: "empty", identity: "" });
    });

    it("allows 60 bytes for a command and 59 for a transfer", () => {
        expect(iconIdentity("x".repeat(PAYLOAD_MAX)).ok).toBe(true);
        expect(iconIdentity("x".repeat(PAYLOAD_MAX + 1))).toEqual({
            ok: false,
            reason: "too-long",
            identity: "x".repeat(PAYLOAD_MAX + 1),
        });
        expect(iconIdentity("x".repeat(PAYLOAD_MAX - 1), "transfer").ok).toBe(true);
        expect(iconIdentity("x".repeat(PAYLOAD_MAX), "transfer")).toEqual({
            ok: false,
            reason: "too-long",
            identity: "x".repeat(PAYLOAD_MAX),
        });
    });
});

describe("profileIdentity", () => {
    it("uses the bare name", () => {
        expect(profileIdentity("Gaming Room")).toEqual({
            ok: true,
            identity: { kind: "profile", name: "Gaming Room", identity: "Gaming Room" },
        });
    });

    it("refuses an empty or oversized name", () => {
        expect(profileIdentity("")).toEqual({ ok: false, reason: "empty", identity: "" });
        expect(profileIdentity("x".repeat(PAYLOAD_MAX)).ok).toBe(true);
        expect(profileIdentity("x".repeat(PAYLOAD_MAX + 1))).toEqual({
            ok: false,
            reason: "too-long",
            identity: "x".repeat(PAYLOAD_MAX + 1),
        });
    });
});

describe("profileRenameIdentity", () => {
    it("owns the `old:new` form", () => {
        expect(profileRenameIdentity("gaming", "retro")).toEqual({
            ok: true,
            identity: {
                kind: "profileRename",
                from: "gaming",
                to: "retro",
                identity: "gaming:retro",
            },
        });
    });

    it("keeps an old name containing a colon unchanged", () => {
        // The firmware splits on the first colon, so this old half is
        // unaddressable; the builder still sends the plain `old:new` form.
        expect(profileRenameIdentity("Gaming: Room", "retro")).toEqual({
            ok: true,
            identity: {
                kind: "profileRename",
                from: "Gaming: Room",
                to: "retro",
                identity: "Gaming: Room:retro",
            },
        });
    });

    it("refuses an empty half", () => {
        expect(profileRenameIdentity("", "retro")).toEqual({
            ok: false,
            reason: "empty",
            identity: ":retro",
        });
        expect(profileRenameIdentity("gaming", "")).toEqual({
            ok: false,
            reason: "empty",
            identity: "gaming:",
        });
    });

    it("counts both halves and the separator against one frame", () => {
        const exact = profileRenameIdentity("a".repeat(29), "b".repeat(30));
        expect(exact.ok).toBe(true);
        if (exact.ok) {
            expect(exact.identity.identity).toHaveLength(PAYLOAD_MAX);
        }
        expect(profileRenameIdentity("a".repeat(30), "b".repeat(30))).toEqual({
            ok: false,
            reason: "too-long",
            identity: `${"a".repeat(30)}:${"b".repeat(30)}`,
        });
    });
});
