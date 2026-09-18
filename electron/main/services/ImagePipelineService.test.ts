import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorageService } from "./StorageService";
import { crc32 } from "./usb/Crc32";
import {
    ICON_SIZE,
    ImagePipelineError,
    ImagePipelineService,
    resolveIconName,
    slugifyIconName,
} from "./ImagePipelineService";

vi.mock("electron-log/main", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

let sharpAvailable = true;
try {
    await import("sharp");
} catch {
    sharpAvailable = false;
}

const tempDirs: string[] = [];

function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucyddeck-icons-"));
    tempDirs.push(dir);
    return dir;
}

function fakeStorage(iconsDir: string): StorageService {
    return { iconsDir: () => iconsDir } as unknown as StorageService;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe("icon name helpers", () => {
    it("slugifies file names", () => {
        expect(slugifyIconName("My Icon.PNG")).toBe("my-icon");
        expect(slugifyIconName("UPPER_case-1.png")).toBe("upper_case-1");
        expect(slugifyIconName("a//b.jpg")).toBe("a-b");
        expect(slugifyIconName("...")).toBe("");
    });

    it("prefers a valid slug and falls back to 'icon'", () => {
        expect(resolveIconName("photo.jpg", "C:/tmp/whatever.png")).toBe("photo");
        expect(resolveIconName(undefined, "C:/tmp/Cool Shot.png")).toBe("cool-shot");
        expect(resolveIconName("...", "C:/tmp/whatever.png")).toBe("icon");
    });
});

describe("ImagePipelineService", () => {
    it("resizes, converts to RGBA PNG, and stores by name", async () => {
        if (!sharpAvailable) {
            return;
        }
        const sharp = (await import("sharp")).default;
        const dir = tempDir();
        const src = path.join(dir, "source.png");
        await sharp({
            create: {
                width: 300,
                height: 100,
                channels: 3,
                background: { r: 200, g: 20, b: 20 },
            },
        })
            .png()
            .toFile(src);

        const pipeline = new ImagePipelineService(fakeStorage(dir), {
            iconsDir: path.join(dir, "icons"),
        });
        const result = await pipeline.importImage(src, "Sample Image");

        expect(result.name).toBe("sample-image");
        expect(fs.existsSync(result.path)).toBe(true);
        expect(result.path).toBe(path.join(dir, "icons", "sample-image.png"));

        const meta = await sharp(result.path).metadata();
        expect(meta.width).toBe(ICON_SIZE);
        expect(meta.height).toBe(ICON_SIZE);
        expect(meta.hasAlpha).toBe(true);

        const stored = fs.readFileSync(result.path);
        expect(result.bytes).toBe(stored.length);
        expect(result.crc32).toBe(crc32(new Uint8Array(stored)));
    });

    it("rejects unsupported formats", async () => {
        if (!sharpAvailable) {
            return;
        }
        const dir = tempDir();
        const src = path.join(dir, "notes.txt");
        fs.writeFileSync(src, "definitely not an image");
        const pipeline = new ImagePipelineService(fakeStorage(dir));
        await expect(pipeline.importImage(src)).rejects.toMatchObject({
            code: "PIPELINE_UNSUPPORTED_FORMAT",
        });
    });

    it("rejects a missing source", async () => {
        const dir = tempDir();
        const pipeline = new ImagePipelineService(fakeStorage(dir));
        await expect(pipeline.importImage(path.join(dir, "nope.png"))).rejects.toBeInstanceOf(
            ImagePipelineError,
        );
    });
});
