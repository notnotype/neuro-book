import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {createClient} from "@libsql/client";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {commitTickMemory, ensureRpCharacter, readTickMemory} from "nbook/server/rp/character-store";
import {runRpConsistencyCheck} from "nbook/server/rp/consistency-store";
import {planRpRuntime, setRpRunIntensity} from "nbook/server/rp/focus-store";
import {RP_MAP_STATE_PATH} from "nbook/server/rp/map-store";
import {defineRpCycle, defineRpResource, openRpResourceAccount} from "nbook/server/rp/mechanics-store";
import {registerNamedRpNpc} from "nbook/server/rp/npc-store";
import {activateIntake, preparePipelineForCommit} from "nbook/server/rp/test-fixtures";
import {createRpTimelineCheckpoint, initializeRpTimeline, readRpTimelineTree, restoreRpTimelineNode} from "nbook/server/rp/timeline-store";
import {beginRpTurnCommit, commitRpTurn, listRpTurns, startRpTurn} from "nbook/server/rp/turn-store";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";

describe("P9 RP 长期验收", {timeout: 300_000}, () => {
    let projectRoot: string;

    beforeAll(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-p9-long-run-"));
        await activateIntake(projectRoot);
        await seedScaleWorld(projectRoot);
    });

    afterAll(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("100 Tick、三档强度、三条时间线与多次长跳保持一致", async () => {
        await initializeRpTimeline(projectRoot, "100 Tick 验收起点");
        for (let sequence = 1; sequence <= 100; sequence += 1) {
            if (sequence === 1) await setRpRunIntensity(projectRoot, "light");
            if (sequence === 34) await setRpRunIntensity(projectRoot, "standard");
            if (sequence === 67) await setRpRunIntensity(projectRoot, "deep");
            const turn = await startRpTurn(projectRoot, {requestKey: `p9:${sequence}`, sessionId: 9, inputSummary: `长期验收行动 ${sequence}`});
            if (sequence % 25 === 0) {
                await planRpRuntime(projectRoot, {
                    turnId: turn.id, longJump: true, startInstant: String(sequence * 3600), endInstant: String((sequence + 7) * 3600),
                    currentNpcIds: ["npc-01"], directInteractionNpcIds: ["npc-02"],
                });
            }
            const prosePath = `rp/ticks/${String(sequence).padStart(6, "0")}-p9/prose.md`;
            await preparePipelineForCommit(projectRoot, turn.id, prosePath);
            await beginRpTurnCommit(projectRoot, turn.id);
            await commitRpTurn(projectRoot, turn.id, prosePath, {summary: `Tick ${sequence} 已完成`}, sequence % 5 !== 0);
        }

        const mainTree = await readRpTimelineTree(projectRoot);
        const mainEndId = mainTree!.activeNodeId;
        const branchPoint = mainTree!.nodes.find((node) => node.tick === 60)!;
        expect((await listRpTurns(projectRoot)).filter((turn) => turn.status === "committed")).toHaveLength(100);

        await restoreRpTimelineNode(projectRoot, {nodeId: branchPoint.id, createSafety: false, safetyLabel: "不使用", replaceNodeId: null});
        await ensureRpCharacter(projectRoot, "npc-01", {name: "角色01"});
        await commitTickMemory(projectRoot, "npc-01", {tick: 101, summaryLine: "只属于支线 A 的记忆", detail: "支线 A 发生的秘密会面"});
        const branchA = await createRpTimelineCheckpoint(projectRoot, {label: "支线 A", summary: "验证角色记忆隔离", replaceNodeId: null});

        await restoreRpTimelineNode(projectRoot, {nodeId: branchPoint.id, createSafety: false, safetyLabel: "不使用", replaceNodeId: null});
        expect(await readTickMemory(projectRoot, "npc-01", 101)).toBeNull();
        const branchB = await createRpTimelineCheckpoint(projectRoot, {label: "支线 B", summary: "第三条时间线", replaceNodeId: null});
        await restoreRpTimelineNode(projectRoot, {nodeId: mainEndId, createSafety: false, safetyLabel: "不使用", replaceNodeId: null});

        const finalTree = await readRpTimelineTree(projectRoot);
        const branchChildren = finalTree!.nodes.find((node) => node.id === branchPoint.id)!.childrenIds;
        expect(branchChildren).toEqual(expect.arrayContaining([branchA.activeNodeId, branchB.activeNodeId]));
        expect(branchChildren).toHaveLength(3);
        expect(await readTickMemory(projectRoot, "npc-01", 101)).toBeNull();

        const report = await runRpConsistencyCheck(projectRoot, "deep", true);
        expect(report.status).toBe("healthy");
        expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    });
});

/** 建立 20 个具名角色、30 个地图节点、10 个周期资源和对应 World subjects。 */
async function seedScaleWorld(projectRoot: string): Promise<void> {
    for (let index = 1; index <= 20; index += 1) {
        const id = `npc-${String(index).padStart(2, "0")}`;
        await registerNamedRpNpc(projectRoot, {id, name: `角色${String(index).padStart(2, "0")}`, origin: "world", narrativeRole: "长期场景角色", playerSummary: "验收角色", household: "普通收入", tick: 0});
    }
    for (let index = 1; index <= 10; index += 1) {
        const id = `periodic-${String(index).padStart(2, "0")}`;
        await defineRpResource(projectRoot, {
            id, label: `周期资源${index}`, kind: "ledger", unit: "点", min: 0, max: 1000, bands: [], derivedRate: null,
            periodicRules: [{id: `${id}-daily`, everySeconds: "86400", delta: 1, anchorInstant: "0", label: "每日增长"}],
        });
        await openRpResourceAccount(projectRoot, {subjectId: "avatar", ownerTier: "player", resourceId: id, initialValue: 10, anchorInstant: "0"});
        await defineRpCycle(projectRoot, {
            id: `cycle-${String(index).padStart(2, "0")}`, subjectId: `npc-${String(index).padStart(2, "0")}`, label: `角色周期${index}`,
            anchorInstant: "0", lengthSeconds: "86400", phases: [{label: "前半", startSecond: "0", endSecond: "43200"}, {label: "后半", startSecond: "43200", endSecond: "86400"}], private: index % 2 === 0,
        });
    }
    const now = new Date(0).toISOString();
    const nodes = Array.from({length: 30}, (_, offset) => {
        const index = offset + 1;
        const id = `location-${String(index).padStart(2, "0")}`;
        return {
            id, worldSubjectId: id, parentId: index === 1 ? null : `location-${String(Math.floor(index / 2)).padStart(2, "0")}`,
            level: index === 1 ? "world" : index < 6 ? "region" : "town", canonicalName: `地点${index}`, playerSummary: "长期验收地点",
            rumorLabel: null, approximateDirection: null, status: "discovered", persistenceBasis: ["world_structure"], origin: "bootstrap",
            sourceRefs: [], solidifiedAtTick: 0, createdAt: now, updatedAt: now,
        };
    });
    const mapPath = join(projectRoot, ...RP_MAP_STATE_PATH.split("/"));
    await mkdir(dirname(mapPath), {recursive: true});
    await writeFile(mapPath, `${JSON.stringify({schemaVersion: 1, nodes, proposals: [], routes: [], updatedAt: now})}\n`, "utf-8");

    const client = createClient({url: toSqliteFileUrl(join(projectRoot, ".nbook/world-rp.sqlite"))});
    try {
        await client.execute(`INSERT INTO "WorldSubject" ("id", "type", "name") VALUES ('avatar', 'character', '玩家')`);
        for (const npc of Array.from({length: 20}, (_, index) => index + 1)) {
            const id = `npc-${String(npc).padStart(2, "0")}`;
            await client.execute({sql: `INSERT INTO "WorldSubject" ("id", "type", "name") VALUES (?, 'character', ?)`, args: [id, `角色${npc}`]});
        }
        for (const location of nodes) await client.execute({sql: `INSERT INTO "WorldSubject" ("id", "type", "name") VALUES (?, 'location', ?)`, args: [location.id, location.canonicalName]});
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
}
