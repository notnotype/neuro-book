import {
    beginRpBootstrap,
    confirmRpIntakeFromPlayer,
    reviewRpIntake,
    RP_INTAKE_FIELD_KEYS,
    type RpBootstrapStage,
    updateRpIntakeField,
} from "nbook/server/rp/intake-store";
import {activateRpAdventure, checkpointRpBootstrap, initializeRpBootstrapConfig, RP_OPENING_STAGING_PATH} from "nbook/server/rp/bootstrap-store";
import {ensureRpCharacter, writeMood, writeSoul} from "nbook/server/rp/character-store";
import {registerFormalEvent, RP_EVENT_LEDGER_PATH, RP_EVENT_STATE_PATH} from "nbook/server/rp/event-store";
import {proposeRpLocation, reviewRpLocationProposal, RP_MAP_LEDGER_PATH, RP_MAP_STATE_PATH} from "nbook/server/rp/map-store";
import {registerNamedRpNpc, RP_NPC_LEDGER_PATH, RP_NPC_STATE_PATH} from "nbook/server/rp/npc-store";
import {
    advanceRpPipeline,
    captureRpTurnSnapshot,
    registerRpNarrative,
    resolveRpProposalConflicts,
    submitRpAdjudication,
    submitRpScreenwriterPlan,
} from "nbook/server/rp/pipeline-store";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {createClient} from "@libsql/client";
import {WorldEngineRepository} from "nbook/server/world-engine/world-engine.repository";
import {ensureRpWorldDatabase, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

/** RP store 测试共用的最小 active 冒险。 */
export async function activateIntake(projectRoot: string): Promise<void> {
    for (const key of RP_INTAKE_FIELD_KEYS) {
        await updateRpIntakeField(projectRoot, key, {status: "confirmed", value: `${key} ready`});
    }
    const reviewing = await reviewRpIntake(projectRoot);
    await confirmRpIntakeFromPlayer(projectRoot, reviewing.version);
    await beginRpBootstrap(projectRoot);
    await prepareBootstrapArtifacts(projectRoot);
    await activateRpAdventure(projectRoot);
    await resetBootstrapFixtureArtifacts(projectRoot);
}

/**
 * 不相关的 RP store 测试需要从空业务状态开始；先通过真实激活验收，再清空夹具产物。
 * Bootstrap 自身测试不调用此函数，因此仍验证完整产物和发布结果。
 */
async function resetBootstrapFixtureArtifacts(projectRoot: string): Promise<void> {
    for (const relativePath of [RP_MAP_STATE_PATH, RP_MAP_LEDGER_PATH, RP_EVENT_STATE_PATH, RP_EVENT_LEDGER_PATH, RP_NPC_STATE_PATH, RP_NPC_LEDGER_PATH]) {
        await rm(join(projectRoot, relativePath), {recursive: true, force: true});
    }
    await rm(join(projectRoot, "rp/characters"), {recursive: true, force: true});
    await rm(join(projectRoot, "rp/ticks"), {recursive: true, force: true});
    const databasePath = join(projectRoot, ".nbook/world-rp.sqlite");
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        for (const table of ["WorldPatch", "WorldSlice", "WorldSubject"]) await client.execute(`DELETE FROM "${table}"`);
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
}

/** 为 RP store 测试建立能通过生产 Bootstrap 验收的最小产物集。 */
export async function prepareBootstrapArtifacts(projectRoot: string, through: RpBootstrapStage = "narrative"): Promise<void> {
    await mkdir(join(projectRoot, "rp/manual"), {recursive: true});
    await mkdir(join(projectRoot, "rp/lorebook"), {recursive: true});
    await writeFile(join(projectRoot, "rp/manual/README.md"), "# 测试冒险\n", "utf-8");
    await initializeRpBootstrapConfig(projectRoot, {calendarPreset: "gregorian"});
    await checkpointRpBootstrap(projectRoot, "config");
    if (through === "config") return;

    const databasePath = join(projectRoot, ".nbook/world-rp.sqlite");
    await ensureRpWorldDatabase(databasePath);
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        const repository = new WorldEngineRepository(client);
        await repository.createSubject({id: "world", type: "world", name: "测试世界"});
        await repository.createSubject({id: "player", type: "character", name: "玩家"});
        await repository.createSubject({id: "npc", type: "character", name: "测试 NPC"});
        await repository.createSubject({id: "start", type: "location", name: "起点"});
        await repository.createSlice(
            {instant: 0n, title: "初始化", summary: "测试初始状态", kind: "init", patches: []},
            [{subjectId: "world", op: "replace", path: "/概况", value: "测试世界已经初始化", seq: 0}],
        );
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
    await checkpointRpBootstrap(projectRoot, "world");
    if (through === "world") return;

    const proposal = await proposeRpLocation(projectRoot, {
        requestedId: "start", level: "world", canonicalName: "起点", playerSummary: "测试起点",
        initialStatus: "discovered", persistenceBasis: ["world_structure"], origin: "bootstrap",
    });
    await reviewRpLocationProposal(projectRoot, proposal.id, {accepted: true});
    await checkpointRpBootstrap(projectRoot, "map");
    if (through === "map") return;

    for (const character of [{id: "player", name: "玩家", kind: "player" as const}, {id: "npc", name: "测试 NPC", kind: "npc" as const}]) {
        await ensureRpCharacter(projectRoot, character.id, {name: character.name, kind: character.kind});
        await writeSoul(projectRoot, character.id, `# ${character.name}\n\n完整测试人设。\n`);
        await writeMood(projectRoot, character.id, "# 心境\n\n平静而专注。\n");
    }
    await registerNamedRpNpc(projectRoot, {
        id: "npc", name: "测试 NPC", origin: "world", narrativeRole: "同伴", playerSummary: "测试同伴",
        personaSummary: "完整测试人设", household: "测试", tick: 0, locationId: "start",
    });
    await checkpointRpBootstrap(projectRoot, "characters");
    if (through === "characters") return;

    await registerFormalEvent(projectRoot, {
        origin: "opening", trigger: "opening_stable", tone: "unusual", title: "测试开场",
        playerSummary: "测试冒险开始", locationId: "start", startActive: true,
    });
    await checkpointRpBootstrap(projectRoot, "opening_event");
    if (through === "opening_event") return;

    const stagingPath = join(projectRoot, RP_OPENING_STAGING_PATH);
    await mkdir(dirname(stagingPath), {recursive: true});
    await writeFile(stagingPath, "# 测试开场正文\n\n冒险开始。\n", "utf-8");
    await checkpointRpBootstrap(projectRoot, "narrative");
}

/**
 * 为不关心编排细节的 store 测试建立最小合法 pipeline。
 * P6 后 begin_commit 必须由同一快照下的计划、冲突收口、终裁与叙事产物共同放行。
 */
export async function preparePipelineForCommit(projectRoot: string, turnId: string, prosePath: string): Promise<void> {
    await advanceRpPipeline(projectRoot, turnId, "world_snapshot", "开始读取本回合世界状态");
    const snapshot = await captureRpTurnSnapshot(projectRoot, turnId, {
        worldInstant: "fixture:0",
        publicSummary: "测试世界快照",
        state: {fixture: true},
    });
    await advanceRpPipeline(projectRoot, turnId, "condition_check", "完成条件检查");
    await advanceRpPipeline(projectRoot, turnId, "screenwriter_plan", "进入轻量编排");
    await submitRpScreenwriterPlan(projectRoot, turnId, {
        snapshotId: snapshot.id,
        expectedActorIds: [],
        extrasRequired: false,
        lightweight: true,
        requiresPlayerRoll: false,
        summary: "无需独立角色提案的测试计划",
    });
    await advanceRpPipeline(projectRoot, turnId, "actor_proposals", "无需角色提案");
    await advanceRpPipeline(projectRoot, turnId, "conflict_resolution", "进入冲突收口");
    await resolveRpProposalConflicts(projectRoot, turnId, {
        snapshotId: snapshot.id,
        conflicts: [],
        resolutions: [],
        mergedSummary: "没有提案冲突",
    });
    await advanceRpPipeline(projectRoot, turnId, "adjudication", "进入终裁");
    await submitRpAdjudication(projectRoot, turnId, snapshot.id, "测试终裁完成", {fixture: true});
    await advanceRpPipeline(projectRoot, turnId, "narrative", "进入叙事生成");
    await registerRpNarrative(projectRoot, turnId, prosePath, "测试叙事已登记");
    await advanceRpPipeline(projectRoot, turnId, "world_commit", "准备提交世界状态");
}
