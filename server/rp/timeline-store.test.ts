import {mkdtemp, readFile, rm, writeFile, mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {createClient} from "@libsql/client";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    createRpTimelineCheckpoint,
    diagnoseRpTimelineNode,
    initializeRpTimeline,
    previewRpTimelineNode,
    readRpTimelineTree,
    restoreRpTimelineNode,
    setRpTimelineNodeLock,
    RP_TIMELINE_PROBLEM_ROOT,
    RP_TIMELINE_ROOT,
} from "nbook/server/rp/timeline-store";
import {readRpCognitionState, readRpPlayerKnowledge, registerRpWorldFact, settleRpCognitionTurn} from "nbook/server/rp/cognition-store";
import {activateIntake, preparePipelineForCommit} from "nbook/server/rp/test-fixtures";
import {beginRpTurnCommit, commitRpTurn, startRpTurn} from "nbook/server/rp/turn-store";
import {ensureRpWorldDatabase, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

describe("RP 世界切片树", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-timeline-"));
        await activateIntake(projectRoot);
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("初始化锁定根节点，并使用完整基线与中间差量", async () => {
        const root = await initializeRpTimeline(projectRoot, "序章起点");
        expect(root.nodes).toHaveLength(1);
        expect(root.nodes[0]).toMatchObject({label: "序章起点", kind: "root", storage: "full", locked: true, depth: 0});

        await writeRuntimeFile(projectRoot, ".nbook/rp/runtime/custom/state.json", {value: 1});
        const next = await createRpTimelineCheckpoint(projectRoot, {label: "第一次变化", summary: "状态发生变化", replaceNodeId: null});
        expect(next.nodes.find((node) => node.id === next.activeNodeId)).toMatchObject({kind: "checkpoint", storage: "delta", depth: 1});
        expect((await previewRpTimelineNode(projectRoot, next.activeNodeId)).integrity).toBe("verified");
    });

    it("每个节点最多四条直接分支，第五条必须替换未锁定分支", async () => {
        const initialized = await initializeRpTimeline(projectRoot);
        const rootId = initialized.rootId;
        const childIds: string[] = [];
        for (let index = 1; index <= 4; index += 1) {
            const branch = await createRpTimelineCheckpoint(projectRoot, {label: `分支 ${index}`, summary: "", replaceNodeId: null});
            childIds.push(branch.activeNodeId);
            await restoreRpTimelineNode(projectRoot, {nodeId: rootId, createSafety: false, safetyLabel: "不使用", replaceNodeId: null});
        }

        await expect(createRpTimelineCheckpoint(projectRoot, {label: "第五分支", summary: "", replaceNodeId: null})).rejects.toThrow("必须选择");
        await setRpTimelineNodeLock(projectRoot, childIds[0]!, true);
        await expect(createRpTimelineCheckpoint(projectRoot, {label: "第五分支", summary: "", replaceNodeId: childIds[0]!})).rejects.toThrow("已锁定");

        const replaced = await createRpTimelineCheckpoint(projectRoot, {label: "第五分支", summary: "", replaceNodeId: childIds[1]!});
        expect(replaced.nodes.find((node) => node.id === rootId)?.childrenIds).toHaveLength(4);
        expect(replaced.archivedNodeCount).toBe(1);
        expect(replaced.nodes.some((node) => node.id === childIds[1])).toBe(false);
    });

    it("恢复角色认知与客观事实，但保留玩家跨分支 OOC 事实", async () => {
        const initialized = await initializeRpTimeline(projectRoot);
        await registerRpWorldFact(projectRoot, {id: "fact:door", statement: "北门后有密道", importance: "normal", tick: 1, source: "亲眼发现"});
        await settleRpCognitionTurn(projectRoot, "turn-cognition", [{
            op: "learn", characterId: "avatar", factId: "fact:door", belief: "believes", content: "北门后有密道", source: "亲眼发现", tick: 1, channel: "observed",
        }]);
        await createRpTimelineCheckpoint(projectRoot, {label: "发现密道", summary: "", replaceNodeId: null});

        await restoreRpTimelineNode(projectRoot, {nodeId: initialized.rootId, createSafety: false, safetyLabel: "不使用", replaceNodeId: null});
        const cognition = await readRpCognitionState(projectRoot);
        expect(cognition.facts).toEqual([]);
        expect(cognition.beliefs).toEqual([]);
        expect(cognition.oocFacts).toMatchObject([{id: "fact:door", statement: "北门后有密道"}]);
        expect(await readRpPlayerKnowledge(projectRoot)).toMatchObject([{fact: {id: "fact:door"}, visibility: "public"}]);
    });

    it("完整导出并恢复 RP World Engine 数据库", async () => {
        const databasePath = join(projectRoot, ".nbook/world-rp.sqlite");
        await ensureRpWorldDatabase(databasePath);
        const initialized = await initializeRpTimeline(projectRoot);
        await writeWorldFixture(databasePath);
        const branch = await createRpTimelineCheckpoint(projectRoot, {label: "世界发生变化", summary: "建立角色与切面", replaceNodeId: null});

        await restoreRpTimelineNode(projectRoot, {nodeId: initialized.rootId, createSafety: false, safetyLabel: "不使用", replaceNodeId: null});
        expect(await worldCount(databasePath, "WorldSlice")).toBe(0);
        expect(await worldCount(databasePath, "WorldSubject")).toBe(0);

        await restoreRpTimelineNode(projectRoot, {nodeId: branch.activeNodeId, createSafety: false, safetyLabel: "不使用", replaceNodeId: null});
        expect(await worldCount(databasePath, "WorldSlice")).toBe(1);
        expect(await worldCount(databasePath, "WorldSubject")).toBe(1);
        expect((await readRpTimelineTree(projectRoot))?.activeNodeId).toBe(branch.activeNodeId);
    });

    it("恢复前安全切片保存当前状态并成为可返回分支", async () => {
        const initialized = await initializeRpTimeline(projectRoot);
        await writeRuntimeFile(projectRoot, ".nbook/rp/runtime/custom/state.json", {value: "未来"});
        const future = await createRpTimelineCheckpoint(projectRoot, {label: "未来", summary: "", replaceNodeId: null});
        await writeRuntimeFile(projectRoot, ".nbook/rp/runtime/custom/state.json", {value: "未保存变化"});

        const restored = await restoreRpTimelineNode(projectRoot, {nodeId: initialized.rootId, createSafety: true, safetyLabel: "恢复前保险", replaceNodeId: null});
        expect(restored.safetyNodeId).not.toBeNull();
        expect(restored.tree.activeNodeId).toBe(initialized.rootId);
        const safety = restored.tree.nodes.find((node) => node.id === restored.safetyNodeId);
        expect(safety).toMatchObject({kind: "safety", storage: "full", parentId: future.activeNodeId});
        await expect(readFile(join(projectRoot, ".nbook/rp/runtime/custom/state.json"), "utf-8")).rejects.toMatchObject({code: "ENOENT"});
    });

    it("切片材料损坏时生成问题报告并只建议最近可验证祖先", async () => {
        const initialized = await initializeRpTimeline(projectRoot, "可验证根节点");
        await writeRuntimeFile(projectRoot, ".nbook/rp/runtime/custom/state.json", {value: "branch"});
        const branch = await createRpTimelineCheckpoint(projectRoot, {label: "损坏目标", summary: "", replaceNodeId: null});
        await restoreRpTimelineNode(projectRoot, {nodeId: initialized.rootId, createSafety: false, safetyLabel: "不使用", replaceNodeId: null});
        const payload = join(projectRoot, RP_TIMELINE_ROOT, "nodes", branch.activeNodeId, "payload", ".nbook", "rp", "runtime", "custom", "state.json");
        await writeFile(payload, "corrupt", "utf-8");

        const report = await diagnoseRpTimelineNode(projectRoot, branch.activeNodeId);
        expect(report).toMatchObject({targetNodeId: branch.activeNodeId, lastVerifiedNodeId: initialized.rootId});
        expect(report?.options).toContain("restore_last_verified");
        expect(await readFile(join(projectRoot, RP_TIMELINE_PROBLEM_ROOT, `${report!.id}.json`), "utf-8")).toContain(branch.activeNodeId);
        await expect(restoreRpTimelineNode(projectRoot, {nodeId: branch.activeNodeId, createSafety: false, safetyLabel: "不使用", replaceNodeId: null})).rejects.toThrow("必须由玩家确认");
        expect((await readRpTimelineTree(projectRoot))?.activeNodeId).toBe(initialized.rootId);
    });

    it("committed 回合自动形成节点，并在第五条分支前阻断 world commit", async () => {
        const initialized = await initializeRpTimeline(projectRoot);
        const first = await startRpTurn(projectRoot, {requestKey: "timeline-auto", sessionId: 1, inputSummary: "向前探索"});
        const prosePath = "rp/ticks/000001-auto/prose.md";
        await preparePipelineForCommit(projectRoot, first.id, prosePath);
        await beginRpTurnCommit(projectRoot, first.id);
        await commitRpTurn(projectRoot, first.id, prosePath, {summary: "完成探索"});
        const captured = await readRpTimelineTree(projectRoot);
        expect(captured?.nodes.find((node) => node.turnId === first.id)).toMatchObject({kind: "turn", tick: 1});

        await restoreRpTimelineNode(projectRoot, {nodeId: initialized.rootId, createSafety: false, safetyLabel: "不使用", replaceNodeId: null});
        for (let index = 1; index <= 3; index += 1) {
            await createRpTimelineCheckpoint(projectRoot, {label: `备用分支 ${index}`, summary: "", replaceNodeId: null});
            await restoreRpTimelineNode(projectRoot, {nodeId: initialized.rootId, createSafety: false, safetyLabel: "不使用", replaceNodeId: null});
        }
        const blocked = await startRpTurn(projectRoot, {requestKey: "timeline-blocked", sessionId: 1, inputSummary: "建立第五分支"});
        await preparePipelineForCommit(projectRoot, blocked.id, "rp/ticks/000002-blocked/prose.md");
        await expect(beginRpTurnCommit(projectRoot, blocked.id)).rejects.toThrow("4 条直接分支");
    });
});

/** 写入受快照管理的测试文件。 */
async function writeRuntimeFile(projectRoot: string, path: string, value: object): Promise<void> {
    const target = join(projectRoot, ...path.split("/"));
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, `${JSON.stringify(value)}\n`, "utf-8");
}

/** 建立最小合法 World Engine 角色与切面。 */
async function writeWorldFixture(databasePath: string): Promise<void> {
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        await client.execute(`INSERT INTO "WorldSubject" ("id", "type", "name") VALUES ('avatar', 'character', '玩家')`);
        await client.execute(`INSERT INTO "WorldSlice" ("id", "instant", "title", "summary", "kind") VALUES ('slice-world', 1, '开始', '', 'event')`);
        await client.execute(`INSERT INTO "WorldPatch" ("id", "sliceId", "subjectId", "instant", "seq", "path", "op", "value") VALUES ('patch-world', 'slice-world', 'avatar', 1, 0, '/hp', 'replace', '100')`);
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
}

/** 查询 World Engine 表行数。 */
async function worldCount(databasePath: string, table: "WorldSlice" | "WorldSubject"): Promise<number> {
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        const result = await client.execute(`SELECT COUNT(*) AS count FROM "${table}"`);
        return Number(result.rows[0]?.count ?? 0);
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
}
