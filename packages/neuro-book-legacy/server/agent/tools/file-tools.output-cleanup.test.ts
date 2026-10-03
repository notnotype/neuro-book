import {mkdtemp, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {JobRunContext, SpawnJobSpec} from "nbook/server/agent/jobs/agent-job-manager";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";

const ownedProcess = vi.hoisted(() => ({
    spawn: vi.fn(),
}));

const output = vi.hoisted(() => ({
    append: vi.fn(),
    snapshot: vi.fn(() => ({
        content: "",
        truncation: {
            content: "",
            truncated: false,
            truncatedBy: null,
            totalLines: 1,
            totalBytes: 0,
            outputLines: 1,
            outputBytes: 0,
        },
    })),
    finish: vi.fn(),
    closeOutput: vi.fn(async () => undefined),
}));

vi.mock("@notnotype/owned-process", () => ({
    spawnOwnedProcess: ownedProcess.spawn,
}));

vi.mock("nbook/server/agent/tools/output-accumulator", () => ({
    OutputAccumulator: class MockOutputAccumulator {
        append = output.append;
        snapshot = output.snapshot;
        finish = output.finish;
        closeOutput = output.closeOutput;
    },
}));

import {createFileTools} from "nbook/server/agent/tools/file-tools";

describe("bash OutputAccumulator cleanup", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(testHostPath("nbook-bash-output-cleanup-"));
        ownedProcess.spawn.mockImplementation(() => ({
            completion: Promise.reject(new Error("owned process failed")),
            terminate: vi.fn(),
        }));
    });

    afterEach(async () => {
        ownedProcess.spawn.mockReset();
        output.append.mockClear();
        output.snapshot.mockClear();
        output.finish.mockClear();
        output.closeOutput.mockClear();
        await rm(root, {recursive: true, force: true});
    });

    it("前台ownership failure仍结束输出并关闭临时文件", async () => {
        const tool = createFileTools().find((candidate) => candidate.key === "bash");
        if (!tool?.executeWithContext) throw new Error("bash工具缺少上下文执行入口。");

        await expect(tool.executeWithContext(createContext(root), "bash-cleanup", {
            command: "exit 1",
        })).rejects.toThrow("owned process failed");

        expect(output.finish).toHaveBeenCalledOnce();
        expect(output.closeOutput).toHaveBeenCalledOnce();
    });

    it("后台ownership failure仍结束输出并关闭临时文件", async () => {
        let backgroundRun: SpawnJobSpec["run"] | undefined;
        const context = createContext(root, (spec) => {
            backgroundRun = spec.run;
        });
        const tool = createFileTools().find((candidate) => candidate.key === "bash");
        if (!tool?.executeWithContext) throw new Error("bash工具缺少上下文执行入口。");

        const started = await tool.executeWithContext(context, "bash-background-cleanup", {
            command: "exit 1",
            background: true,
        });
        expect(started.details).toEqual(expect.objectContaining({
            jobId: "job_output_cleanup",
            jobEventCursor: {eventEpoch: "epoch-jobs", after: 1},
        }));
        if (!backgroundRun) throw new Error("后台bash没有登记Job执行器。");

        const controller = new AbortController();
        const jobContext: JobRunContext = {
            signal: controller.signal,
            setPreview() {},
            setWaiting() {},
            setRunning() {},
        };
        await expect(backgroundRun(jobContext)).rejects.toThrow("owned process failed");

        expect(output.finish).toHaveBeenCalledOnce();
        expect(output.closeOutput).toHaveBeenCalledOnce();
    });

    it("finish自身失败时仍关闭临时文件", async () => {
        output.finish.mockImplementationOnce(() => {
            throw new Error("finish failed");
        });
        const tool = createFileTools().find((candidate) => candidate.key === "bash");
        if (!tool?.executeWithContext) throw new Error("bash工具缺少上下文执行入口。");

        await expect(tool.executeWithContext(createContext(root), "bash-finish-cleanup", {
            command: "exit 1",
        })).rejects.toThrow("finish failed");

        expect(output.closeOutput).toHaveBeenCalledOnce();
    });
});

/** 构造只包含bash路径所需能力的工具上下文。 */
function createContext(root: string, onSpawn?: (spec: SpawnJobSpec) => void): ToolExecutionContext {
    const jobs = {
        spawn(spec: SpawnJobSpec) {
            onSpawn?.(spec);
            return {
                job: {jobId: "job_output_cleanup"},
                jobEventCursor: {eventEpoch: "epoch-jobs", after: 1},
            };
        },
    };
    const harness = {
        workspaceRoot: root,
        runtimePaths: createRuntimePaths({
            applicationRoot: absoluteFsPath(root),
            stateRoot: absoluteFsPath(root),
        }),
        jobs,
    } as unknown as NeuroAgentHarness;
    return {
        harness,
        sessionId: 1,
        profileKey: "test.output-cleanup",
        workspaceRoot: absoluteFsPath(root),
        currentProject: null,
    };
}
