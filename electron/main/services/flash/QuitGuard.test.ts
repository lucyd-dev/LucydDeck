import { describe, expect, it, vi } from "vitest";
import { QuitGuard } from "./QuitGuard";

describe("QuitGuard", () => {
    it("asks once per flash", async () => {
        const guard = new QuitGuard();
        const ask = vi.fn(async () => true);
        guard.beginFlash();

        await expect(guard.confirm(ask)).resolves.toBe(true);
        expect(guard.isConfirmed()).toBe(true);
        await expect(guard.confirm(ask)).resolves.toBe(true);
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it("asks again for the next flash in the same session", async () => {
        const guard = new QuitGuard();
        const ask = vi.fn<() => Promise<boolean>>();
        ask.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

        guard.beginFlash();
        await expect(guard.confirm(ask)).resolves.toBe(true);

        guard.beginFlash();
        expect(guard.isConfirmed()).toBe(false);
        await expect(guard.confirm(ask)).resolves.toBe(false);
        expect(ask).toHaveBeenCalledTimes(2);
    });
});
