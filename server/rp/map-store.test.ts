import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createClient} from "@libsql/client";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    approveRpLocationConflict,
    arriveRpLocation,
    confirmRpLocationImports,
    discoverRpMapRoute,
    proposeRpLocation,
    readRpMapState,
    readRpPlayerMap,
    registerRpMapRoute,
    replaceRpLocationProposal,
    reviewRpLocationProposal,
    requiredRpMapSubjectType,
    setRpLocationStatus,
    stageRpLocationImports,
} from "nbook/server/rp/map-store";
import {activateIntake} from "nbook/server/rp/test-fixtures";
import {WorldEngineRepository} from "nbook/server/world-engine/world-engine.repository";
import {toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

describe("RP map store", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-map-"));
        await activateIntake(projectRoot);
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("只把可持续承载内容的地点固化为层级节点", async () => {
        const root = await proposeRpLocation(projectRoot, location("world", "world", null, "世界"));
        await ensureWorldSubject("world", "world", "世界");
        await expect(reviewRpLocationProposal(projectRoot, root.id, {accepted: true})).resolves.toMatchObject({id: "world", level: "world"});

        const transient = await proposeRpLocation(projectRoot, {...location("flash", "building", "world", "一闪而过的门廊"), persistenceBasis: []});
        await expect(reviewRpLocationProposal(projectRoot, transient.id, {accepted: true})).rejects.toThrow("一次性背景空间");

        const town = await proposeRpLocation(projectRoot, location("harbor", "town", "world", "港城"));
        await ensureWorldSubject("harbor", "town", "港城");
        await expect(reviewRpLocationProposal(projectRoot, town.id, {accepted: true})).resolves.toMatchObject({parentId: "world", worldSubjectId: "harbor"});
    });

    it("节点落地前按地图层级校验同 ID World Engine subject 类型", async () => {
        const proposal = await proposeRpLocation(projectRoot, location("wrong-root", "world", null, "错误世界根"));
        await ensureWorldSubject("wrong-root", "town", "错误世界根");

        await expect(reviewRpLocationProposal(projectRoot, proposal.id, {accepted: true})).rejects.toThrow("world 层级要求 world subject，实际为 location");
        expect((await readRpMapState(projectRoot)).nodes.some((node) => node.id === "wrong-root")).toBe(false);
        expect((await readRpMapState(projectRoot)).proposals.find((item) => item.id === proposal.id)?.status).toBe("proposed");
    });

    it("传闻节点降级展示，秘密路线发现前从玩家视图完全消失", async () => {
        await createLocation("world", "world", null, "世界", "discovered");
        await createLocation("harbor", "town", "world", "港城", "discovered");
        await createLocation("cave", "sub_location", "harbor", "潮下密窟", "rumored", {rumorLabel: "海崖下的空洞", approximateDirection: "港城西南"});
        await registerRpMapRoute(projectRoot, {id: "smuggler-path", fromId: "harbor", toId: "cave", label: "走私暗道", secret: true});

        const hidden = await readRpPlayerMap(projectRoot);
        expect(hidden.nodes.find((node) => node.id === "cave")).toMatchObject({label: "海崖下的空洞", status: "rumored"});
        expect(hidden.routes).toHaveLength(0);

        await discoverRpMapRoute(projectRoot, "smuggler-path", 4);
        expect((await readRpPlayerMap(projectRoot)).routes).toHaveLength(1);
    });

    it("首次抵达自动固化且关闭、毁坏节点不会删除", async () => {
        await createLocation("world", "world", null, "世界", "discovered");
        await createLocation("tower", "building", "world", "旧塔", "rumored");
        await expect(arriveRpLocation(projectRoot, "tower", 7)).resolves.toMatchObject({status: "discovered", solidifiedAtTick: 7});
        await setRpLocationStatus(projectRoot, "tower", "destroyed", "塔楼在风暴中倒塌");
        await expect(setRpLocationStatus(projectRoot, "tower", "discovered", "静默恢复")).rejects.toThrow("世界修订流程");
        expect((await readRpMapState(projectRoot)).nodes.find((node) => node.id === "tower")).toMatchObject({status: "destroyed"});
    });

    it("设定冲突必须先展示原因并获得玩家覆盖批准", async () => {
        const proposal = await proposeRpLocation(projectRoot, location("moon-port", "world", null, "月港"));
        await expect(reviewRpLocationProposal(projectRoot, proposal.id, {accepted: false, conflictReasons: ["既有设定中月亮上没有定居点"]})).resolves.toMatchObject({status: "conflict"});
        await expect(reviewRpLocationProposal(projectRoot, proposal.id, {accepted: true})).rejects.toThrow("未获玩家处理");
        await approveRpLocationConflict(projectRoot, proposal.id, true);
        await ensureWorldSubject("moon-port", "world", "月港");
        await expect(reviewRpLocationProposal(projectRoot, proposal.id, {accepted: true})).resolves.toMatchObject({id: "moon-port"});
        await expect(reviewRpLocationProposal(projectRoot, proposal.id, {accepted: true})).resolves.toMatchObject({id: "moon-port"});
        expect((await readRpMapState(projectRoot)).nodes.filter((node) => node.id === "moon-port")).toHaveLength(1);
    });

    it("不同定义的重复提案必须显式替换并保留审计链", async () => {
        await createLocation("world", "world", null, "世界", "discovered");
        const invalid = await proposeRpLocation(projectRoot, {
            ...location("forest", "building", null, "尽头之森"),
            level: "region",
        });
        await reviewRpLocationProposal(projectRoot, invalid.id, {accepted: false, conflictReasons: ["region 缺少父节点"]});
        const corrected = {...location("forest", "building", "world", "尽头之森"), level: "region" as const};
        await expect(proposeRpLocation(projectRoot, corrected)).rejects.toThrow("replace_proposal");
        const replacement = await replaceRpLocationProposal(projectRoot, invalid.id, corrected);
        expect(replacement).toMatchObject({requestedId: "forest", parentId: "world", status: "proposed", supersedesProposalId: invalid.id});
        await ensureWorldSubject("forest", "building", "尽头之森");
        await expect(reviewRpLocationProposal(projectRoot, replacement.id, {accepted: true})).resolves.toMatchObject({id: "forest"});
        expect((await readRpMapState(projectRoot)).proposals.find((item) => item.id === invalid.id)).toMatchObject({status: "superseded", supersededById: replacement.id});
        await expect(replaceRpLocationProposal(projectRoot, replacement.id, corrected)).rejects.toThrow("materialized");
    });

    it("小说地点盘点必须整批确认，主持不能静默漏掉候选", async () => {
        const staged = await stageRpLocationImports(projectRoot, [
            {...location("capital", "world", null, "王都"), sourceRefs: ["lorebook/王都.md"]},
            {...location("academy", "world", null, "学院"), sourceRefs: ["manuscript/第一章.md"], completeness: "partial"},
        ]);
        await expect(confirmRpLocationImports(projectRoot, [{proposalId: staged[0]!.id, include: true}])).rejects.toThrow("覆盖当前全部待确认地点");
        const confirmed = await confirmRpLocationImports(projectRoot, [
            {proposalId: staged[0]!.id, include: true},
            {proposalId: staged[1]!.id, include: false},
        ]);
        expect(confirmed.map((item) => item.status)).toEqual(["proposed", "rejected"]);
    });

    async function createLocation(id: string, level: "world" | "town" | "building" | "sub_location", parentId: string | null, name: string, status: "rumored" | "discovered", extra: {rumorLabel?: string; approximateDirection?: string} = {}) {
        const proposal = await proposeRpLocation(projectRoot, {...location(id, level, parentId, name), initialStatus: status, ...extra});
        await ensureWorldSubject(id, level, name);
        return reviewRpLocationProposal(projectRoot, proposal.id, {accepted: true});
    }

    /** 为地图落地测试建立同 ID 的最小 World Engine 身份。 */
    async function ensureWorldSubject(id: string, level: "world" | "town" | "building" | "sub_location", name: string): Promise<void> {
        const client = createClient({url: toSqliteFileUrl(join(projectRoot, ".nbook/world-rp.sqlite"))});
        try {
            const repository = new WorldEngineRepository(client);
            if (!await repository.findSubject(id)) {
                await repository.createSubject({id, type: requiredRpMapSubjectType(level), name});
            }
        } finally {
            client.close();
            collectReleasedSqliteHandles({force: true});
        }
    }
});

function location(id: string, level: "world" | "town" | "building" | "sub_location", parentId: string | null, name: string) {
    return {
        requestedId: id,
        parentId,
        level,
        canonicalName: name,
        playerSummary: `${name}的玩家可见摘要`,
        initialStatus: "discovered" as const,
        persistenceBasis: ["world_structure" as const],
        origin: "screenwriter" as const,
    };
}
