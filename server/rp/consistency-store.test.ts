import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {runRpConsistencyCheck} from "nbook/server/rp/consistency-store";
import {RP_MAP_STATE_PATH} from "nbook/server/rp/map-store";
import {initializeRpTimeline, RP_TIMELINE_TREE_PATH} from "nbook/server/rp/timeline-store";
import {activateIntake} from "nbook/server/rp/test-fixtures";

describe("RP 一致性审计", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-consistency-"));
        await activateIntake(projectRoot);
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("light/standard/deep 三档对最小 active 世界均通过", async () => {
        for (const level of ["light", "standard", "deep"] as const) {
            await expect(runRpConsistencyCheck(projectRoot, level)).resolves.toMatchObject({level, status: "healthy"});
        }
    });

    it("自动重建切片 childrenIds 索引，但不擅自修复剧情引用", async () => {
        const timeline = await initializeRpTimeline(projectRoot);
        const treePath = join(projectRoot, ...RP_TIMELINE_TREE_PATH.split("/"));
        const tree = JSON.parse(await readFile(treePath, "utf-8")) as {nodes: Array<{id: string; childrenIds: string[]}>};
        tree.nodes.find((node) => node.id === timeline.rootId)!.childrenIds = ["slice-0-deadbeef"];
        await writeFile(treePath, `${JSON.stringify(tree)}\n`, "utf-8");

        const repaired = await runRpConsistencyCheck(projectRoot, "light", true);
        expect(repaired.repaired).toContainEqual(expect.objectContaining({code: "timeline.children_index"}));
        expect(repaired.status).toBe("healthy");

        const mapPath = join(projectRoot, ...RP_MAP_STATE_PATH.split("/"));
        await mkdir(join(projectRoot, ".nbook/rp/runtime/map"), {recursive: true});
        await writeFile(mapPath, `${JSON.stringify({
            schemaVersion: 1,
            nodes: [{id: "room", worldSubjectId: "room", parentId: "missing", level: "building", canonicalName: "房间", playerSummary: "", rumorLabel: null, approximateDirection: null, status: "discovered", persistenceBasis: ["world_structure"], origin: "bootstrap", sourceRefs: [], solidifiedAtTick: 1, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString()}],
            proposals: [], routes: [], updatedAt: new Date(0).toISOString(),
        })}\n`, "utf-8");
        const blocked = await runRpConsistencyCheck(projectRoot, "standard", true);
        expect(blocked.status).toBe("blocked");
        expect(blocked.issues).toContainEqual(expect.objectContaining({code: "map.parent_missing", repair: "player_confirmation"}));
    });
});
