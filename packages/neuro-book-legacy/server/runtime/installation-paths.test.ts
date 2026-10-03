import path from "node:path";
import {describe, expect, it} from "vitest";

import {
    resolveApplicationRoot,
    resolveBootConfigPath,
    resolveStateRoot,
    resolveStateWorkspaceRoot,
} from "nbook/server/runtime/installation-paths";

describe("installation paths", () => {
    it("默认 State Root 使用平台用户根而非 Application Root", () => {
        const root = path.resolve("C:/neuro-book");
        const stateRoot = resolveStateRoot(root, {});
        expect(resolveApplicationRoot(root, {})).toBe(root);
        expect(stateRoot).not.toBe(root);
        expect(resolveStateWorkspaceRoot(root, {})).toBe(path.join(stateRoot, "workspace"));
    });

    it("Portable 可把 State Root 指向 data", () => {
        const root = path.resolve("C:/neuro-book");
        const env = {NEURO_BOOK_APPLICATION_ROOT: root, NEURO_BOOK_STATE_ROOT: "data"};
        expect(resolveStateRoot(root, env)).toBe(path.join(root, "data"));
        expect(resolveBootConfigPath(root, env)).toBe(path.join(root, "data", "config.yaml"));
    });
});
