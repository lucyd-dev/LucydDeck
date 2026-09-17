import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    DATA_DIR_ENV,
    PAGE_FILE_PATTERN,
    StorageService,
    isPageConfig,
    resolveDataDir,
    validateName,
} from "./StorageService";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

function tempDataDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-storage-test-"));
}

describe("resolveDataDir", () => {
    it("prefers the LUCYD_DECK_DATA_DIR env override on every platform", () => {
        const override = path.join("some", "custom", "dir");
        for (const platform of ["win32", "linux", "darwin"]) {
            expect(
                resolveDataDir({
                    platform,
                    env: { [DATA_DIR_ENV]: override },
                    homeDir: "/home/u",
                }),
            ).toBe(path.resolve(override));
        }
    });

    it("ignores a blank env override", () => {
        const result = resolveDataDir({
            platform: "linux",
            env: { [DATA_DIR_ENV]: "   " },
            homeDir: "/home/u",
        });
        expect(result).toBe(path.join("/home/u", ".config", "LucydDeck"));
    });

    it("resolves %APPDATA%\\LucydDeck on Windows", () => {
        const result = resolveDataDir({
            platform: "win32",
            env: { APPDATA: "C:/Users/u/AppData/Roaming" },
            homeDir: "C:/Users/u",
        });
        expect(result).toBe(path.join("C:/Users/u/AppData/Roaming", "LucydDeck"));
    });

    it("falls back to ~/AppData/Roaming on Windows without APPDATA", () => {
        const result = resolveDataDir({
            platform: "win32",
            env: {},
            homeDir: "C:/Users/u",
        });
        expect(result).toBe(path.join("C:/Users/u/AppData/Roaming", "LucydDeck"));
    });

    it("prefers $XDG_CONFIG_HOME/LucydDeck on Linux", () => {
        const result = resolveDataDir({
            platform: "linux",
            env: { XDG_CONFIG_HOME: "/custom/xdg" },
            homeDir: "/home/u",
        });
        expect(result).toBe(path.join("/custom/xdg", "LucydDeck"));
    });

    it("falls back to ~/.config/LucydDeck on Linux", () => {
        const result = resolveDataDir({
            platform: "linux",
            env: {},
            homeDir: "/home/u",
        });
        expect(result).toBe(path.join("/home/u", ".config", "LucydDeck"));
    });

    it("resolves ~/Library/Application Support/LucydDeck on macOS", () => {
        const result = resolveDataDir({
            platform: "darwin",
            env: {},
            homeDir: "/Users/u",
        });
        expect(result).toBe(path.join("/Users/u", "Library", "Application Support", "LucydDeck"));
    });
});

describe("validateName", () => {
    it("rejects empty, dot, and dotdot names", () => {
        expect(validateName("")).toBe(false);
        expect(validateName(".")).toBe(false);
        expect(validateName("..")).toBe(false);
    });

    it("rejects path separators and control characters", () => {
        expect(validateName("a/b")).toBe(false);
        expect(validateName("a\\b")).toBe(false);
        expect(validateName("a\nb")).toBe(false);
        expect(validateName("a\tb")).toBe(false);
        expect(validateName("a\u0000b")).toBe(false);
        expect(validateName("a\u007fb")).toBe(false);
    });

    it("rejects Windows-reserved device names and trailing dots/spaces", () => {
        expect(validateName("CON")).toBe(false);
        expect(validateName("con")).toBe(false);
        expect(validateName("NUL")).toBe(false);
        expect(validateName("AUX")).toBe(false);
        expect(validateName("COM1")).toBe(false);
        expect(validateName("COM9")).toBe(false);
        expect(validateName("LPT1")).toBe(false);
        expect(validateName("main.")).toBe(false);
        expect(validateName("main ")).toBe(false);
        expect(validateName("main .")).toBe(false);
    });

    it("accepts a normal name that merely starts like a reserved one", () => {
        // Only COM1..COM9 are reserved; COM10 is an ordinary name.
        // Reserved names remain reserved when followed by an extension/dot.
        expect(validateName("COM10")).toBe(true);
        expect(validateName("con.fig")).toBe(false);
    });

    it("accepts normal names", () => {
        expect(validateName("main")).toBe(true);
        expect(validateName("Space Cadet")).toBe(true);
        expect(validateName("42")).toBe(true);
    });
});

describe("StorageService profile CRUD", () => {
    let dataDir = "";
    let storage: StorageService;

    beforeEach(() => {
        dataDir = tempDataDir();
        storage = new StorageService({ dataDir });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it("creates the layout directories", () => {
        storage.ensureLayout();
        for (const sub of ["profiles", "icons", "plugins", "tools", "logs"]) {
            expect(fs.existsSync(path.join(dataDir, sub))).toBe(true);
        }
    });

    it("round-trips profiles: create, list, rename, delete", () => {
        expect(storage.listProfiles()).toEqual([]);

        storage.createProfile("main");
        storage.createProfile("work");
        expect(storage.listProfiles().map((p) => p.name)).toEqual(["main", "work"]);

        expect(() => storage.createProfile("main")).toThrow();

        storage.renameProfile("main", "home");
        expect(storage.listProfiles().map((p) => p.name)).toEqual(["home", "work"]);

        storage.deleteProfile("work");
        expect(storage.listProfiles().map((p) => p.name)).toEqual(["home"]);
    });

    it("rejects invalid profile names at the service boundary", () => {
        expect(() => storage.createProfile("../evil")).toThrow();
        expect(() => storage.createProfile("a/b")).toThrow();
        expect(() => storage.renameProfile("missing", "other")).toThrow();
        expect(() => storage.deleteProfile("missing")).toThrow();
    });

    it("maps page filenames to canonical ids", () => {
        storage.createProfile("main");
        storage.savePage("main", "0", { buttons: {} });
        storage.savePage("main", "12", { buttons: {} });

        const pages = storage.listPages("main");
        expect(pages.map((p) => p.id)).toEqual(["0", "12"]);
    });

    it("ignores non-canonical page filenames", () => {
        storage.createProfile("main");
        fs.writeFileSync(path.join(dataDir, "profiles", "main", "notes.txt"), "x");
        fs.writeFileSync(path.join(dataDir, "profiles", "main", "01.json"), "{}");
        fs.writeFileSync(path.join(dataDir, "profiles", "main", "page.json"), "{}");

        expect(storage.listPages("main").map((p) => p.id)).toEqual(["01"]);
    });

    it("rejects invalid page ids", () => {
        storage.createProfile("main");
        expect(() => storage.savePage("main", "../x", { buttons: {} })).toThrow();
        expect(() => storage.loadPage("main", "abc")).toThrow();
    });

    it("loads what it saved, pretty-printed with a trailing newline", () => {
        storage.createProfile("main");
        const page = {
            buttons: {
                "0": {
                    label: "Launch",
                    click: ["CMD:explorer.exe"],
                    longPress: [],
                },
            },
        };
        storage.savePage("main", "3", page);

        expect(storage.loadPage("main", "3")).toEqual(page);

        const raw = fs.readFileSync(path.join(dataDir, "profiles", "main", "3.json"), "utf8");
        expect(raw).toMatch(/\n$/);
        expect(() => isPageConfig(JSON.parse(raw))).not.toThrow();
    });

    it("rejects a page file that is not a valid PageConfig", () => {
        storage.createProfile("main");
        fs.writeFileSync(
            path.join(dataDir, "profiles", "main", "0.json"),
            JSON.stringify({ buttons: "nope" }),
        );
        expect(() => storage.loadPage("main", "0")).toThrow();
    });
});

describe("StorageService export/import", () => {
    let dataDir = "";
    let storage: StorageService;

    beforeEach(() => {
        dataDir = tempDataDir();
        storage = new StorageService({
            dataDir,
            dialogs: {
                async pickExportDirectory() {
                    return path.join(dataDir, "exported");
                },
                async pickImportDirectory() {
                    return path.join(dataDir, "incoming");
                },
            },
        });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it("exports a profile to the picked directory", async () => {
        storage.ensureLayout();
        storage.createProfile("main");
        storage.savePage("main", "0", { buttons: {} });

        const result = await storage.exportProfile("main");
        expect(result).not.toBeNull();
        expect(fs.existsSync(path.join(dataDir, "exported", "0.json"))).toBe(true);
    });

    it("returns null when the export dialog is cancelled", async () => {
        storage = new StorageService({
            dataDir,
            dialogs: {
                async pickExportDirectory() {
                    return null;
                },
                async pickImportDirectory() {
                    return null;
                },
            },
        });
        storage.createProfile("main");

        expect(await storage.exportProfile("main")).toBeNull();
    });

    it("imports the directory picked by the dialog", async () => {
        storage.ensureLayout();
        const src = path.join(dataDir, "incoming");
        fs.mkdirSync(src, { recursive: true });
        fs.writeFileSync(path.join(src, "0.json"), JSON.stringify({ buttons: {} }));

        const meta = await storage.importProfile();
        expect(meta).not.toBeNull();
        expect(meta!.name).toBe("incoming");
        expect(fs.existsSync(path.join(dataDir, "profiles", "incoming", "0.json"))).toBe(true);
    });

    it("returns null when the import dialog is cancelled", async () => {
        storage = new StorageService({
            dataDir,
            dialogs: {
                async pickExportDirectory() {
                    return null;
                },
                async pickImportDirectory() {
                    return null;
                },
            },
        });
        storage.ensureLayout();

        expect(await storage.importProfile()).toBeNull();
    });

    it("imports a directory as a profile via the low-level copy", async () => {
        storage.ensureLayout();
        const src = path.join(dataDir, "incoming");
        fs.mkdirSync(src, { recursive: true });
        fs.writeFileSync(path.join(src, "0.json"), JSON.stringify({ buttons: {} }));

        const meta = storage.importProfileFrom(src);
        expect(meta.name).toBe("incoming");
        expect(fs.existsSync(path.join(dataDir, "profiles", "incoming", "0.json"))).toBe(true);
    });

    it("rejects importing over an existing profile name", async () => {
        storage.createProfile("dup");
        const src = path.join(dataDir, "import-src", "dup");
        fs.mkdirSync(src, { recursive: true });
        fs.writeFileSync(path.join(src, "0.json"), JSON.stringify({ buttons: {} }));

        expect(() => storage.importProfileFrom(src)).toThrow(/already exists/);
        expect(() => storage.importProfileFrom(path.join(dataDir, "missing"))).toThrow();
    });
});

describe("PAGE_FILE_PATTERN", () => {
    it("extracts the leading digits as the id", () => {
        expect(PAGE_FILE_PATTERN.exec("0.json")?.[1]).toBe("0");
        expect(PAGE_FILE_PATTERN.exec("12.json")?.[1]).toBe("12");
        expect(PAGE_FILE_PATTERN.exec("007.json")?.[1]).toBe("007");
        expect(PAGE_FILE_PATTERN.exec("page.json")).toBeNull();
        expect(PAGE_FILE_PATTERN.exec(".json")).toBeNull();
    });
});
