import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {appLogger} from "nbook/server/app-logs/logger";
import {subjectMemorySourceHash} from "nbook/server/agent/tools/subject-memory";
import {
    clearSubjectRagDirty,
    markSubjectRagDirty,
    type SubjectPaths,
    type SubjectRagSourceType,
} from "nbook/server/agent/tools/subject-rag-index";

type DirtySourceState = {
    dirty: true;
    sourceHash: string;
    updatedAt: string;
};

type DirtyState = Record<string, Partial<Record<SubjectRagSourceType, DirtySourceState>>>;

describe("subject RAG dirty state", () => {
    let root: string;
    let ragStatePath: string;

    beforeEach(async () => {
        root = await mkdtemp(testHostPath("nbook-subject-rag-dirty-"));
        ragStatePath = path.join(root, ".nbook", "subject-rag-dirty.json");
        vi.spyOn(appLogger, "warn").mockResolvedValue();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await rm(root, {recursive: true, force: true});
    });

    it("并发 mark 与 clear 保留多 subject/source，且旧 hash clear 不删除新标记", async () => {
        const alpha = subjectPaths("alpha", ragStatePath);
        const beta = subjectPaths("beta", ragStatePath);
        const alphaEvents = "alpha-events-v1";
        const alphaMemory = "alpha-memory-v1";
        const betaEvents = "beta-events-v1";
        const betaMemory = "beta-memory-v1";

        await Promise.all([
            markSubjectRagDirty(alpha, "events", alphaEvents),
            markSubjectRagDirty(alpha, "memory", alphaMemory),
            markSubjectRagDirty(beta, "events", betaEvents),
            markSubjectRagDirty(beta, "memory", betaMemory),
        ]);

        const initial = await readDirtyState(ragStatePath);
        expect(initial[alpha.absolutePath]?.events?.sourceHash).toBe(subjectMemorySourceHash(alphaEvents));
        expect(initial[alpha.absolutePath]?.memory?.sourceHash).toBe(subjectMemorySourceHash(alphaMemory));
        expect(initial[beta.absolutePath]?.events?.sourceHash).toBe(subjectMemorySourceHash(betaEvents));
        expect(initial[beta.absolutePath]?.memory?.sourceHash).toBe(subjectMemorySourceHash(betaMemory));

        const alphaMemoryNext = "alpha-memory-v2";
        const betaEventsNext = "beta-events-v2";
        await Promise.all([
            clearSubjectRagDirty(alpha, "events", subjectMemorySourceHash(alphaEvents)),
            markSubjectRagDirty(alpha, "memory", alphaMemoryNext),
            markSubjectRagDirty(beta, "events", betaEventsNext),
            clearSubjectRagDirty(beta, "memory", subjectMemorySourceHash(betaMemory)),
        ]);

        const afterMixedWrites = await readDirtyState(ragStatePath);
        expect(afterMixedWrites[alpha.absolutePath]?.events).toBeUndefined();
        expect(afterMixedWrites[alpha.absolutePath]?.memory?.sourceHash).toBe(subjectMemorySourceHash(alphaMemoryNext));
        expect(afterMixedWrites[beta.absolutePath]?.events?.sourceHash).toBe(subjectMemorySourceHash(betaEventsNext));
        expect(afterMixedWrites[beta.absolutePath]?.memory).toBeUndefined();

        const alphaEventsNext = "alpha-events-v2";
        await Promise.all([
            markSubjectRagDirty(alpha, "events", alphaEventsNext),
            clearSubjectRagDirty(alpha, "events", subjectMemorySourceHash(alphaEvents)),
        ]);

        const finalState = await readDirtyState(ragStatePath);
        expect(finalState[alpha.absolutePath]?.events?.sourceHash).toBe(subjectMemorySourceHash(alphaEventsNext));
        expect((await readdir(path.dirname(ragStatePath))).some((name) => name.endsWith(".tmp"))).toBe(false);
    });

    it("损坏 JSON 按空的可重建状态修复，维护写失败不向调用方抛出", async () => {
        const alpha = subjectPaths("alpha", ragStatePath);
        await mkdir(path.dirname(ragStatePath), {recursive: true});
        await writeFile(ragStatePath, "{broken", "utf-8");

        await expect(markSubjectRagDirty(alpha, "events", "alpha-events")).resolves.toBeUndefined();
        const repaired = await readDirtyState(ragStatePath);
        expect(repaired[alpha.absolutePath]?.events?.sourceHash).toBe(subjectMemorySourceHash("alpha-events"));

        const blockedStatePath = path.join(root, ".nbook", "blocked-state");
        await mkdir(blockedStatePath, {recursive: true});
        const blocked = subjectPaths("blocked", blockedStatePath);
        await expect(markSubjectRagDirty(blocked, "memory", "committed-source")).resolves.toBeUndefined();
        expect(appLogger.warn).toHaveBeenCalledWith(
            "agent.subjectRag.dirtyStateMarkFailed",
            expect.objectContaining({
                ragStatePath: blockedStatePath,
                subjectPath: blocked.absolutePath,
                sourceType: "memory",
            }),
            expect.any(String),
        );
    });
});

/** 构造共享 dirty state 文件的 subject 路径。 */
function subjectPaths(subjectId: string, statePath: string): SubjectPaths {
    const absolutePath = path.join(path.dirname(path.dirname(statePath)), "simulation", "subjects", subjectId);
    return {
        absolutePath,
        eventsPath: path.join(absolutePath, "events.jsonl"),
        memoryPath: path.join(absolutePath, "memory.jsonl"),
        ragStatePath: statePath,
    };
}

/** 读取并解析测试中的 dirty state；解析失败直接让测试失败。 */
async function readDirtyState(statePath: string): Promise<DirtyState> {
    return JSON.parse(await readFile(statePath, "utf-8")) as DirtyState;
}
