import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializePageConfig } from "@shared/schema";
import {
    DATA_DIR_ENV,
    PAGE_FILE_PATTERN,
    StorageService,
    isPageConfig,
    resolveDataDir,
    validateName,
} from "./StorageService";
import { crc32Upload } from "./usb/Crc32";

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

    it("gives a new profile an empty first page", () => {
        storage.createProfile("main");

        expect(storage.listPages("main").map((page) => page.id)).toEqual(["0"]);
        expect(storage.loadPage("main", "0")).toEqual({ buttons: {} });
        expect(fs.readFileSync(path.join(dataDir, "profiles", "main", "0.json"), "utf8")).toBe(
            `${JSON.stringify(serializePageConfig({ buttons: {} }), null, 2)}\n`,
        );
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

        expect(storage.listPages("main").map((p) => p.id)).toEqual(["0", "01"]);
    });

    it("rejects invalid page ids", () => {
        storage.createProfile("main");
        expect(() => storage.savePage("main", "../x", { buttons: {} })).toThrow();
        expect(() => storage.loadPage("main", "abc")).toThrow();
    });

    it("deletes a page and refuses a missing one", () => {
        storage.createProfile("main");
        storage.savePage("main", "0", { buttons: {} });
        storage.savePage("main", "1", { buttons: {} });

        storage.deletePage("main", "0");
        expect(storage.listPages("main").map((p) => p.id)).toEqual(["1"]);
        expect(() => storage.loadPage("main", "0")).toThrow();

        expect(() => storage.deletePage("main", "0")).toThrow();
        expect(() => storage.deletePage("missing", "1")).toThrow();
        expect(() => storage.deletePage("main", "../x")).toThrow();
    });

    it("loads what it saved, pretty-printed with a trailing newline", () => {
        storage.createProfile("main");
        const page = {
            buttons: {
                "0": {
                    label: "Launch",
                    click: ["CMD:explorer.exe"],
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

describe("StorageService default profile", () => {
    let dataDir = "";
    let storage: StorageService;

    beforeEach(() => {
        dataDir = tempDataDir();
        storage = new StorageService({ dataDir });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it("persists, resolves, and surfaces the default flag", () => {
        storage.createProfile("main");
        storage.createProfile("work");
        expect(storage.getDefaultProfile()).toBeNull();

        storage.setDefaultProfile("work");
        expect(storage.getDefaultProfile()).toBe("work");
        expect(storage.listProfiles().map((p) => [p.name, p.isDefault])).toEqual([
            ["main", false],
            ["work", true],
        ]);

        // Renaming the default follows the rename.
        storage.renameProfile("work", "office");
        expect(storage.getDefaultProfile()).toBe("office");

        // Deleting the default clears it.
        storage.deleteProfile("office");
        expect(storage.getDefaultProfile()).toBeNull();
    });

    it("clears the default with null and rejects missing profiles", () => {
        storage.createProfile("main");
        storage.setDefaultProfile("main");
        storage.setDefaultProfile(null);
        expect(storage.getDefaultProfile()).toBeNull();
        expect(() => storage.setDefaultProfile("ghost")).toThrow(/not found/);
    });
});

describe("StorageService app settings", () => {
    let dataDir = "";
    let storage: StorageService;

    beforeEach(() => {
        dataDir = tempDataDir();
        storage = new StorageService({ dataDir });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it("defaults when settings.json has no app section", () => {
        expect(storage.getAppSettings().theme).toBe("system");
        expect(storage.getAppSettings().accent).toBe("violet");
    });

    it("persists appearance and window settings beside defaultProfile", () => {
        storage.createProfile("main");
        storage.setDefaultProfile("main");
        storage.setAppSettings({ theme: "light", accent: "blue" });
        const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")) as {
            defaultProfile?: string;
            app?: { theme?: string; accent?: string };
        };
        expect(saved.defaultProfile).toBe("main");
        expect(saved.app?.theme).toBe("light");
        expect(saved.app?.accent).toBe("blue");
        expect(storage.getAppSettings().theme).toBe("light");
    });

    it("sanitizes hostile settings and clamps window bounds", () => {
        fs.writeFileSync(
            path.join(dataDir, "settings.json"),
            JSON.stringify({ app: { theme: "neon", accent: 42, window: { width: 1 } } }),
        );
        const settings = storage.getAppSettings();
        expect(settings.theme).toBe("system");
        expect(settings.accent).toBe("violet");
        expect(settings.window.width).toBe(1024);
    });

    it("reports the canonical page hash matching the upload bytes", () => {
        storage.createProfile("main");
        const page = {
            buttons: { "1": { label: "Run", click: ["CMD:echo hi"] } },
        };
        storage.savePage("main", "0", page);
        const hash = storage.listPages("main")[0].hash;
        expect(typeof hash).toBe("number");
        expect(storage.pageHash("main", "0")).toBe(hash);
        // The device stores the zero-padded HID payloads, so its list hash is
        // the CRC of the padded canonical JSON, not the unpadded file.
        const canonical = new TextEncoder().encode(
            JSON.stringify(serializePageConfig(page as never)),
        );
        expect(hash).toBe(crc32Upload(canonical));
    });
});

describe("StorageService reference scan", () => {
    let dataDir = "";
    let storage: StorageService;

    beforeEach(() => {
        dataDir = tempDataDir();
        storage = new StorageService({ dataDir });
        storage.createProfile("main");
        storage.createProfile("work");
        storage.createProfile("gaming");
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function saveSteps(profile: string, id: string, steps: string[], imageName?: string): void {
        storage.savePage(profile, id, {
            buttons: {
                "0": {
                    click: steps,
                    ...(imageName === undefined ? {} : { imageName }),
                },
            },
        });
    }

    it("returns one hit per page that uses an icon, across profiles", () => {
        saveSteps("main", "0", [], "github");
        saveSteps("main", "1", [], "github");
        saveSteps("work", "3", [], "github");
        saveSteps("work", "4", [], "other");

        expect(storage.scanReferences({ kind: "icon", name: "github" })).toEqual({
            hits: [
                { profile: "main", pageId: "0" },
                { profile: "main", pageId: "1" },
                { profile: "work", pageId: "3" },
            ],
            partial: false,
        });
    });

    it("reports icon references even when the icon exists on neither side", () => {
        saveSteps("main", "2", [], "missing-everywhere");

        expect(storage.scanReferences({ kind: "icon", name: "missing-everywhere" }).hits).toEqual([
            { profile: "main", pageId: "2" },
        ]);
    });

    it("finds pages stepped to from the same profile only", () => {
        saveSteps("main", "0", ["PAGE:3"]);
        saveSteps("main", "3", []);
        saveSteps("main", "4", ["PAGE:3"]);
        saveSteps("work", "0", ["PAGE:3"]);

        expect(storage.scanReferences({ kind: "page", profile: "main", id: "3" }).hits).toEqual([
            { profile: "main", pageId: "0" },
            { profile: "main", pageId: "4" },
        ]);
    });

    it("does not count the page being deleted as its own reference", () => {
        saveSteps("main", "3", ["PAGE:3"]);
        saveSteps("main", "0", ["PAGE:3"]);

        expect(storage.scanReferences({ kind: "page", profile: "main", id: "3" }).hits).toEqual([
            { profile: "main", pageId: "0" },
        ]);
    });

    it("finds PROFILE steps from pages outside the profile only", () => {
        saveSteps("main", "0", ["PROFILE:work"]);
        saveSteps("work", "0", ["PROFILE:work"]);
        saveSteps("gaming", "1", ["PROFILE:work"]);

        expect(storage.scanReferences({ kind: "profile", name: "work" }).hits).toEqual([
            { profile: "gaming", pageId: "1" },
            { profile: "main", pageId: "0" },
        ]);
    });

    it("skips an unreadable page, keeps the other hits and reports partial", () => {
        saveSteps("main", "0", [], "github");
        saveSteps("main", "1", [], "github");
        fs.writeFileSync(path.join(dataDir, "profiles", "main", "2.json"), "{not json");
        saveSteps("work", "5", [], "github");

        expect(storage.scanReferences({ kind: "icon", name: "github" })).toEqual({
            hits: [
                { profile: "main", pageId: "0" },
                { profile: "main", pageId: "1" },
                { profile: "work", pageId: "5" },
            ],
            partial: true,
        });
    });

    it("reports itself whole when every page reads", () => {
        saveSteps("main", "0", [], "github");
        expect(storage.scanReferences({ kind: "icon", name: "github" }).partial).toBe(false);
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
