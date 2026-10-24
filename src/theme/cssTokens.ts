/**
 * Read one CSS custom property from the document root. Used where a canvas or
 * a native colour input needs the computed token rather than a CSS var.
 */
export function readCssToken(name: string, fallback = ""): string {
    if (typeof document === "undefined") {
        return fallback;
    }
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
