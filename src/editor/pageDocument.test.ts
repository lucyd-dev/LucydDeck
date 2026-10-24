import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import type { PageConfig } from "@shared/types";
import {
    COALESCE_WINDOW_MS,
    HISTORY_LIMIT,
    PageDocumentHistory,
    clonePageConfig,
} from "./pageDocument";

function page(label: string): PageConfig {
    return { buttons: { "0": { label, click: [] } } };
}

describe("PageDocumentHistory", () => {
    it("undoes and redoes a change", () => {
        const history = new PageDocumentHistory();
        const before = page("Home");
        history.record("page-0", before);

        expect(history.canUndo("page-0")).toBe(true);
        expect(history.undo("page-0", page("Media"))).toEqual(before);
        expect(history.canUndo("page-0")).toBe(false);
        expect(history.canRedo("page-0")).toBe(true);
        expect(history.redo("page-0", before)).toEqual(page("Media"));
    });

    it("returns null when there is nothing to undo or redo", () => {
        const history = new PageDocumentHistory();
        expect(history.undo("page-0", page("Home"))).toBeNull();
        expect(history.redo("page-0", page("Home"))).toBeNull();
    });

    it("copies a Vue reactive page without a DataCloneError", () => {
        const live = reactive(page("Home"));
        const copy = clonePageConfig(live);
        expect(copy).toEqual(page("Home"));

        copy.buttons["0"].label = "Changed";
        expect(live.buttons["0"].label).toBe("Home");
    });

    it("keeps snapshots independent of later edits", () => {
        const history = new PageDocumentHistory();
        const current = page("Home");
        history.record("page-0", current);
        current.buttons["0"].label = "Changed after record";

        expect(history.undo("page-0", current)).toEqual(page("Home"));
    });

    it("coalesces typing on one field into a single entry", () => {
        const history = new PageDocumentHistory();
        history.record("page-0", page("H"), { coalesce: "label", now: 1000 });
        history.record("page-0", page("Ho"), { coalesce: "label", now: 1000 + 100 });
        history.record("page-0", page("Hom"), { coalesce: "label", now: 1000 + 200 });

        expect(history.undo("page-0", page("Home"))).toEqual(page("H"));
        expect(history.canUndo("page-0")).toBe(false);
    });

    it("starts a new entry after the coalescing window or a different field", () => {
        const history = new PageDocumentHistory();

        history.record("page-0", page("H"), { coalesce: "label", now: 1000 });
        history.record("page-0", page("Ho"), {
            coalesce: "label",
            now: 1000 + COALESCE_WINDOW_MS + 1,
        });
        expect(history.undo("page-0", page("Hom"))).toEqual(page("Ho"));
        expect(history.canUndo("page-0")).toBe(true);

        const second = new PageDocumentHistory();
        second.record("page-0", page("H"), { coalesce: "label", now: 1000 });
        second.record("page-0", page("H"), { coalesce: "background", now: 1100 });
        expect(second.undo("page-0", page("Home"))).toEqual(page("H"));
        expect(second.canUndo("page-0")).toBe(true);
    });

    it("caps history at 100 entries", () => {
        const history = new PageDocumentHistory();
        for (let index = 0; index < HISTORY_LIMIT + 5; index++) {
            history.record("page-0", page(`step-${index}`), { now: index * 2000 });
        }
        let current = page("current");
        for (let index = 0; index < HISTORY_LIMIT; index++) {
            const previous = history.undo("page-0", current);
            expect(previous).not.toBeNull();
            current = previous!;
        }
        expect(history.undo("page-0", current)).toBeNull();
        expect(current.buttons["0"].label).toBe("step-5");
    });

    it("records one entry for a multi-key apply", () => {
        const history = new PageDocumentHistory();
        const before = {
            buttons: {
                "0": { click: [] },
                "1": { click: [] },
            },
        } satisfies PageConfig;
        history.record("page-0", before);

        const after = {
            buttons: {
                "0": { backgroundColor: "#123456", click: [] },
                "1": { backgroundColor: "#123456", click: [] },
            },
        } satisfies PageConfig;

        expect(history.undo("page-0", after)).toEqual(before);
    });

    it("keeps separate histories per page and survives a page switch", () => {
        const history = new PageDocumentHistory();
        history.record("page-0", page("Home"));
        history.record("page-1", page("Media"));

        expect(history.undo("page-1", page("Media changed"))).toEqual(page("Media"));
        expect(history.canUndo("page-0")).toBe(true);
        expect(history.undo("page-0", page("Home changed"))).toEqual(page("Home"));
    });

    it("clears one page or every page", () => {
        const history = new PageDocumentHistory();
        history.record("page-0", page("Home"));
        history.record("page-1", page("Media"));

        history.clear("page-0");
        expect(history.canUndo("page-0")).toBe(false);
        expect(history.canUndo("page-1")).toBe(true);

        history.clear();
        expect(history.canUndo("page-1")).toBe(false);
    });

    it("drops the redo stack when a new change lands after undo", () => {
        const history = new PageDocumentHistory();
        history.record("page-0", page("Home"));
        history.undo("page-0", page("Media"));
        history.record("page-0", page("Home"));
        expect(history.canRedo("page-0")).toBe(false);
    });
});
