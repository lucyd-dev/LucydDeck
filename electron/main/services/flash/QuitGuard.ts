/**
 * Per-flash confirmation for quitting during a firmware write.
 *
 * A "quit anyway" answer must not carry over to a later flash in the same app
 * session, so `beginFlash` clears it before each write starts.
 */
export class QuitGuard {
    private confirmed = false;

    /** Start a new flash; the next quit attempt asks again. */
    beginFlash(): void {
        this.confirmed = false;
    }

    /** True once the user allowed a quit for the current write. */
    isConfirmed(): boolean {
        return this.confirmed;
    }

    /** Ask once for this flash; a confirmed answer covers further attempts. */
    async confirm(ask: () => Promise<boolean>): Promise<boolean> {
        if (this.confirmed) {
            return true;
        }
        const confirmed = await ask();
        if (confirmed) {
            this.confirmed = true;
        }
        return confirmed;
    }
}
