import {resolve} from "node:path";

import {afterEach, describe, expect, it, vi} from "vitest";

import type {OwnedProcessTerminationReason} from "@notnotype/owned-process";

const ownedProcess = vi.hoisted(() => ({
    spawn: vi.fn(),
}));

vi.mock("@notnotype/owned-process", () => ({
    spawnOwnedProcess: ownedProcess.spawn,
}));

import {runBash} from "nbook/server/agent/tools/file-tools";

afterEach(() => {
    vi.useRealTimers();
    ownedProcess.spawn.mockReset();
});

describe("runBash Owned Process mapping", () => {
    it("timeout先发生且清理期间abort时仍以lease的timeout终态分类", async () => {
        vi.useFakeTimers();
        const terminal = Promise.withResolvers<{
            exitCode: number | null;
            signal: NodeJS.Signals | null;
            terminationReason: "timeout";
        }>();
        const terminate = vi.fn((_reason: OwnedProcessTerminationReason) => terminal.promise);
        ownedProcess.spawn.mockReturnValue({completion: terminal.promise, terminate});
        const controller = new AbortController();
        const execution = runBash({
            bash: "bash",
            command: "sleep 60",
            cwd: resolve("."),
            env: process.env,
            timeout: 1,
            signal: controller.signal,
            onData() {},
        });

        await vi.advanceTimersByTimeAsync(1_000);
        controller.abort();
        terminal.resolve({exitCode: null, signal: null, terminationReason: "timeout"});

        await expect(execution).rejects.toThrow("Command timed out after 1 seconds");
        expect(terminate.mock.calls.map(([reason]) => reason)).toEqual(["timeout", "abort"]);
    });

    it("timeout请求到达但lease已自然完成时不把结果重分类", async () => {
        vi.useFakeTimers();
        const terminal = Promise.withResolvers<{exitCode: number; signal: null}>();
        const terminate = vi.fn((_reason: OwnedProcessTerminationReason) => terminal.promise);
        ownedProcess.spawn.mockReturnValue({completion: terminal.promise, terminate});
        const execution = runBash({
            bash: "bash",
            command: "exit 0",
            cwd: resolve("."),
            env: process.env,
            timeout: 1,
            onData() {},
        });

        await vi.advanceTimersByTimeAsync(1_000);
        terminal.resolve({exitCode: 0, signal: null});

        await expect(execution).resolves.toEqual({exitCode: 0});
        expect(terminate).toHaveBeenCalledWith("timeout");
    });
});
