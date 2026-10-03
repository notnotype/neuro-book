import {beforeEach, describe, expect, it, vi} from "vitest";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

const mocks = vi.hoisted(() => ({
    requireReadyModuleHandle: vi.fn(),
    recordProjectWrite: vi.fn(async () => undefined),
    recordProjectDelete: vi.fn(async () => undefined),
}));

vi.mock("nbook/server/runtime/product-project", () => ({
    requireReadyModuleHandle: mocks.requireReadyModuleHandle,
}));

vi.mock("nbook/server/workspace-files/project-file-index", () => ({
    PROJECT_FILE_INDEX_MODULE_TOKEN: {name: "file-index", kind: "required"},
}));

vi.mock("nbook/server/workspace-history/project-history", () => ({
    LOCAL_USER_ID: "local",
    PROJECT_HISTORY_MODULE_TOKEN: {name: "history", kind: "required"},
    recordProjectWrite: mocks.recordProjectWrite,
    recordProjectDelete: mocks.recordProjectDelete,
}));

describe("user file recorder", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("使用落盘前捕获的 exact handles 记录本地用户", async () => {
        const ready = readyProject(1);
        const history = {generation: 1};
        const fileIndex = {mutate: vi.fn()};
        mocks.requireReadyModuleHandle.mockImplementation((_ready, token: {name: string}) => (
            token.name === "history" ? history : fileIndex
        ));
        const {captureUserProjectFileWrite, recordUserProjectFileWrite} = await import("nbook/server/workspace-history/user-file-recorder");

        const capture = captureUserProjectFileWrite(ready, "simulation/subjects/heroine/events.jsonl");
        await recordUserProjectFileWrite({capture, before: "before", after: "after"});

        expect(mocks.requireReadyModuleHandle).toHaveBeenCalledTimes(2);
        expect(mocks.requireReadyModuleHandle.mock.calls.every(([captured]) => captured === ready)).toBe(true);
        expect(capture.fileIndex).toBe(fileIndex);
        expect(mocks.recordProjectWrite).toHaveBeenCalledWith(history, {
            relativePath: "simulation/subjects/heroine/events.jsonl",
            actor: {kind: "user", userId: "local"},
            before: new TextEncoder().encode("before"),
            after: new TextEncoder().encode("after"),
        });
    });

    it("旧 capture 在 close/reopen 后分别 fail-open，且不查询新 generation", async () => {
        const oldReady = readyProject(1);
        const newReady = readyProject(2);
        const oldHistory = {generation: 1};
        const newHistory = {generation: 2};
        const oldIndex = {mutate: vi.fn()};
        const newIndex = {mutate: vi.fn()};
        let current = oldReady;
        mocks.requireReadyModuleHandle.mockImplementation((ready: ReadyProjectSessionRef, token: {name: string}) => {
            const generationHandles = ready === oldReady
                ? {history: oldHistory, fileIndex: oldIndex}
                : {history: newHistory, fileIndex: newIndex};
            return token.name === "history" ? generationHandles.history : generationHandles.fileIndex;
        });
        const {captureUserProjectFileWrite, recordUserProjectFileWrite} = await import("nbook/server/workspace-history/user-file-recorder");
        const capture = captureUserProjectFileWrite(current, "simulation/subjects/heroine/memory.jsonl");
        current = newReady;
        mocks.recordProjectWrite.mockRejectedValueOnce(new Error("old history closed"));
        await expect(recordUserProjectFileWrite({capture, before: "before", after: "after"})).resolves.toBeUndefined();

        expect(mocks.requireReadyModuleHandle).toHaveBeenCalledTimes(2);
        expect(mocks.requireReadyModuleHandle.mock.calls.every(([captured]) => captured === oldReady)).toBe(true);
        expect(mocks.recordProjectWrite).toHaveBeenCalledWith(oldHistory, expect.any(Object));
        expect(mocks.recordProjectWrite).not.toHaveBeenCalledWith(newHistory, expect.any(Object));
        expect(capture.fileIndex).toBe(oldIndex);
        expect(capture.fileIndex).not.toBe(newIndex);
    });
});

/** 构造只用于 identity 比较的 ready generation。 */
function readyProject(generation: number): ReadyProjectSessionRef {
    return {generation} as ReadyProjectSessionRef;
}
