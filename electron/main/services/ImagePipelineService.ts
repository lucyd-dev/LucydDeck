import fs from "node:fs";
import path from "node:path";
import log from "electron-log/main";
import { crc32 } from "./usb/Crc32";
import { validateName } from "./StorageService";
import type { StorageService } from "./StorageService";

/** Device button geometry (px); icons are stored square at this size. */
export const ICON_SIZE = 140;

/** Image formats the pipeline accepts as input. */
export const SUPPORTED_IMAGE_FORMATS = ["png", "jpeg", "jpg", "webp"] as const;

export const ImagePipelineErrorCodes = {
    SourceMissing: "PIPELINE_SOURCE_MISSING",
    UnsupportedFormat: "PIPELINE_UNSUPPORTED_FORMAT",
    Unavailable: "PIPELINE_UNAVAILABLE",
    WriteFailed: "PIPELINE_WRITE_FAILED",
} as const;

export class ImagePipelineError extends Error {
    readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = "ImagePipelineError";
        this.code = code;
    }
}

export interface ImportedIcon {
    /** Base name without extension (stored as `icons/<name>.png`). */
    name: string;
    /** Absolute path of the stored PNG. */
    path: string;
    /** Stored PNG size in bytes. */
    bytes: number;
    /** CRC-32 of the stored PNG (matches the device's list hash). */
    crc32: number;
}

export interface ImagePipelineServiceOptions {
    size?: number;
    /** Override for tests; defaults to `<dataDir>/icons`. */
    iconsDir?: string;
}

/**
 * Turn a user-supplied image into a device-ready 140×140 RGBA PNG.
 *
 * Pure name handling lives in `slugifyIconName`/`resolveIconName` so it can be
 * unit-tested without the native `sharp` dependency; `importImage` loads sharp
 * lazily and reports `PIPELINE_UNAVAILABLE` if the native install is missing.
 */
export class ImagePipelineService {
    private readonly iconsDir: string;
    private readonly size: number;

    constructor(storage: StorageService, options: ImagePipelineServiceOptions = {}) {
        this.iconsDir = options.iconsDir ?? storage.iconsDir();
        this.size = options.size ?? ICON_SIZE;
    }

    /**
     * Validate, resize (`cover`, 140×140), flatten to RGBA, encode as PNG, and
     * store under `icons/<name>.png`. Returns `{name, path, bytes, crc32}`.
     */
    async importImage(src: string, desiredName?: string): Promise<ImportedIcon> {
        if (!src || !fs.existsSync(src)) {
            throw new ImagePipelineError(
                `Image not found: "${src}"`,
                ImagePipelineErrorCodes.SourceMissing,
            );
        }

        const sharp = await loadSharp();
        let metadata: { format?: string };
        try {
            metadata = await sharp(src, { failOn: "error" }).metadata();
        } catch (error) {
            throw new ImagePipelineError(
                `Unsupported or unreadable image: ${String(error)}`,
                ImagePipelineErrorCodes.UnsupportedFormat,
            );
        }
        const format = metadata.format ?? "";
        if (!SUPPORTED_IMAGE_FORMATS.includes(format as (typeof SUPPORTED_IMAGE_FORMATS)[number])) {
            throw new ImagePipelineError(
                `Unsupported image format: "${format}" (expected ${SUPPORTED_IMAGE_FORMATS.join(
                    "/",
                )})`,
                ImagePipelineErrorCodes.UnsupportedFormat,
            );
        }

        const output = await sharp(src, { failOn: "error" })
            .resize(this.size, this.size, { fit: "cover", position: "centre" })
            .ensureAlpha()
            .png()
            .toBuffer();

        const name = resolveIconName(desiredName, src);
        const dest = path.join(this.iconsDir, `${name}.png`);
        try {
            fs.mkdirSync(this.iconsDir, { recursive: true });
            fs.writeFileSync(dest, output);
        } catch (error) {
            throw new ImagePipelineError(
                `Could not store icon "${name}": ${String(error)}`,
                ImagePipelineErrorCodes.WriteFailed,
            );
        }
        log.info(`[icons] imported ${src} -> ${dest} (${output.length} bytes)`);
        return { name, path: dest, bytes: output.length, crc32: crc32(output) };
    }
}

type SharpFactory = typeof import("sharp");

async function loadSharp(): Promise<SharpFactory> {
    try {
        const module = await import("sharp");
        const withDefault = module as unknown as { default?: SharpFactory };
        return withDefault.default ?? (module as unknown as SharpFactory);
    } catch (error) {
        throw new ImagePipelineError(
            `sharp is unavailable: ${String(error)}`,
            ImagePipelineErrorCodes.Unavailable,
        );
    }
}

/**
 * Slugify a filename (or explicit name) into a safe icon base name:
 * lowercase, extension stripped, non `[a-z0-9._-]` collapsed to `-`.
 */
export function slugifyIconName(input: string): string {
    const base = input.replace(/\.[a-zA-Z0-9]+$/, "");
    return base
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * Resolve the stored icon name: prefer the slug of `desiredName` (or the source
 * basename), fall back to `icon` when the slug fails `validateName`.
 */
export function resolveIconName(
    desiredName: string | undefined,
    src: string,
    isValid: (name: string) => boolean = validateName,
): string {
    const candidate = slugifyIconName(desiredName ?? path.basename(src));
    if (candidate !== "" && isValid(candidate)) {
        return candidate;
    }
    return "icon";
}
