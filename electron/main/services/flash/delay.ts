/** Promise-based sleep used by the flasher's polling loops. */
export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
