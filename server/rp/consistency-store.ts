import {randomUUID} from "node:crypto";
import {access, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {createClient} from "@libsql/client";
import {readCharacterRegistry} from "nbook/server/rp/character-store";
import {readRpCognitionState, type RpCognitionState} from "nbook/server/rp/cognition-store";
import {readRpEventState, type RpEventState} from "nbook/server/rp/event-store";
import {readRpFocusState, type RpFocusState} from "nbook/server/rp/focus-store";
import {readRpIntake, type RpIntakeState} from "nbook/server/rp/intake-store";
import {readRpMapState, type RpMapState} from "nbook/server/rp/map-store";
import {readRpMechanicsState, type RpMechanicsState} from "nbook/server/rp/mechanics-store";
import {readRpNpcState, type RpNpcState} from "nbook/server/rp/npc-store";
import {readRpPipeline, RP_PIPELINE_STAGES} from "nbook/server/rp/pipeline-store";
import {readRpRelationState, type RpRelationState} from "nbook/server/rp/relation-store";
import {inspectRpTimelineIntegrity} from "nbook/server/rp/timeline-store";
import {listRpTurns, type RpTurnRecord} from "nbook/server/rp/turn-store";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import type {
    RpConsistencyIssueDto,
    RpConsistencyLevelDto,
    RpConsistencyReportDto,
} from "nbook/shared/dto/rp-runtime.dto";
import {RpConsistencyReportDtoSchema} from "nbook/shared/dto/rp-runtime.dto";

export const RP_CONSISTENCY_REPORT_PATH = ".nbook/rp/runtime/consistency/latest.json";

type AuditState = {
    intake: RpIntakeState | null;
    events: RpEventState | null;
    focus: RpFocusState | null;
    map: RpMapState | null;
    mechanics: RpMechanicsState | null;
    npcs: RpNpcState | null;
    relations: RpRelationState | null;
    cognition: RpCognitionState | null;
    turns: RpTurnRecord[] | null;
    characterIds: Set<string>;
    worldSubjectIds: Set<string>;
};

const locks = new Map<string, Promise<void>>();

/** 读取最近一次审计；尚未运行时返回 null，损坏报告不会被静默忽略。 */
export async function readRpConsistencyReport(projectRoot: string): Promise<RpConsistencyReportDto | null> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(projectRoot, RP_CONSISTENCY_REPORT_PATH), "utf-8"));
        return RpConsistencyReportDtoSchema.parse(parsed);
    } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
    }
}

/** 项目打开时仅对已经存在 RP intake 的项目运行 standard 审计，避免给普通小说项目创建 RP 文件。 */
export async function auditRpOnProjectOpen(projectRoot: string): Promise<RpConsistencyReportDto | null> {
    try {
        await access(join(projectRoot, ".nbook/rp/intake/state.json"));
    } catch {
        return null;
    }
    return runRpConsistencyCheck(projectRoot, "standard", true);
}

/**
 * 运行 RP 一致性审计。automatic 修复严格限于可重建索引；剧情、资源、关系和认知问题只报告。
 */
export async function runRpConsistencyCheck(projectRoot: string, level: RpConsistencyLevelDto, repairSafe = true): Promise<RpConsistencyReportDto> {
    return withLock(projectRoot, async () => {
        const started = Date.now();
        const issues: RpConsistencyIssueDto[] = [];
        const repaired: RpConsistencyReportDto["repaired"] = [];
        const state = await readAuditState(projectRoot, issues, level);
        await checkWorldDatabase(projectRoot, state.intake, level, issues, state.worldSubjectIds);
        checkDuplicateIds(state, issues);
        checkTurnSettlements(state, issues);
        checkTimeAndResources(state, issues);
        if (level !== "light") {
            checkMapAndNpcReferences(state, issues);
            checkEventAndFocusReferences(state, issues);
            checkRelationAndCognitionReferences(state, issues);
            await checkPipelines(projectRoot, state.turns ?? [], issues);
        }
        const timeline = await inspectRpTimelineIntegrity(projectRoot, {deep: level === "deep", repairIndexes: repairSafe});
        issues.push(...timeline.issues);
        repaired.push(...timeline.repaired);
        const unresolved = issues.filter((issue) => !repaired.some((item) => item.code === issue.code && (item.scope === issue.scope || item.scope === "timeline")));
        const report: RpConsistencyReportDto = {
            schemaVersion: 1,
            level,
            status: unresolved.some((issue) => issue.severity === "error") ? "blocked" : unresolved.length ? "warning" : "healthy",
            issues,
            repaired,
            checkedAt: new Date().toISOString(),
            durationMs: Date.now() - started,
        };
        await writeJsonAtomic(join(projectRoot, RP_CONSISTENCY_REPORT_PATH), report);
        return report;
    });
}

/** 读取并执行各 store 自身 schema；外部持久文件解析异常会被转换为阻断问题。 */
async function readAuditState(projectRoot: string, issues: RpConsistencyIssueDto[], level: RpConsistencyLevelDto): Promise<AuditState> {
    const [intake, events, focus, map, mechanics, npcs, relations, cognition, turns, registry] = await Promise.all([
        readChecked("intake", () => readRpIntake(projectRoot), issues),
        readChecked("events", () => readRpEventState(projectRoot), issues),
        readChecked("focus", () => readRpFocusState(projectRoot), issues),
        readChecked("map", () => readRpMapState(projectRoot), issues),
        readChecked("mechanics", () => readRpMechanicsState(projectRoot), issues),
        readChecked("npcs", () => readRpNpcState(projectRoot), issues),
        readChecked("relations", () => readRpRelationState(projectRoot), issues),
        readChecked("cognition", () => readRpCognitionState(projectRoot), issues),
        readChecked("turns", () => listRpTurns(projectRoot), issues),
        level === "light" ? Promise.resolve(null) : readChecked("characters", () => readCharacterRegistry(projectRoot), issues),
    ]);
    return {
        intake, events, focus, map, mechanics, npcs, relations, cognition, turns,
        characterIds: new Set([...(registry ?? []).map((item) => item.id), ...(npcs?.npcs ?? []).map((item) => item.id)]),
        worldSubjectIds: new Set<string>(),
    };
}

/** 统一把 schema/读取错误记录为需要人工处理的数据损坏。 */
async function readChecked<T>(scope: string, reader: () => Promise<T>, issues: RpConsistencyIssueDto[]): Promise<T | null> {
    try {
        return await reader();
    } catch (error) {
        issues.push({code: "schema.invalid", severity: "error", scope, message: `${scope} 状态无法读取：${errorMessage(error)}`, repair: "player_confirmation"});
        return null;
    }
}

/** 检查各集合主键重复；重复记录无法在不改变事实的前提下自动选择保留项。 */
function checkDuplicateIds(state: AuditState, issues: RpConsistencyIssueDto[]): void {
    const collections: Array<{scope: string; ids: string[]}> = [
        {scope: "events", ids: state.events?.events.map((item) => item.id) ?? []},
        {scope: "map.nodes", ids: state.map?.nodes.map((item) => item.id) ?? []},
        {scope: "map.routes", ids: state.map?.routes.map((item) => item.id) ?? []},
        {scope: "npcs", ids: state.npcs?.npcs.map((item) => item.id) ?? []},
        {scope: "resources", ids: state.mechanics?.resources.map((item) => item.id) ?? []},
        {scope: "accounts", ids: state.mechanics?.accounts.map((item) => item.id) ?? []},
        {scope: "relations", ids: state.relations?.edges.map((item) => item.id) ?? []},
        {scope: "facts", ids: state.cognition?.facts.map((item) => item.id) ?? []},
        {scope: "turns", ids: state.turns?.map((item) => item.id) ?? []},
    ];
    for (const collection of collections) {
        const duplicates = duplicateValues(collection.ids);
        if (duplicates.length) issues.push({code: "reference.duplicate_id", severity: "error", scope: collection.scope, message: `发现重复 id：${duplicates.join("、")}`, repair: "player_confirmation"});
    }
}

/** 检查规则结算 idempotency 集合只能引用正式 committed 回合，且不得出现重复条目。 */
function checkTurnSettlements(state: AuditState, issues: RpConsistencyIssueDto[]): void {
    const committed = new Set((state.turns ?? []).filter((turn) => turn.status === "committed").map((turn) => turn.id));
    const sets = [
        {scope: "mechanics.settledTurnIds", ids: state.mechanics?.settledTurnIds ?? []},
        {scope: "relations.settledTurnIds", ids: state.relations?.settledTurnIds ?? []},
        {scope: "cognition.settledTurnIds", ids: state.cognition?.settledTurnIds ?? []},
    ];
    for (const set of sets) {
        const duplicates = duplicateValues(set.ids);
        if (duplicates.length) issues.push({code: "turn.duplicate_settlement", severity: "error", scope: set.scope, message: `同一回合出现重复结算标记：${duplicates.join("、")}`, repair: "player_confirmation"});
        const invalid = set.ids.filter((id) => !committed.has(id));
        if (invalid.length) issues.push({code: "turn.uncommitted_settlement", severity: "error", scope: set.scope, message: `结算标记引用了非 committed 回合：${invalid.join("、")}`, repair: "player_confirmation"});
    }
}

/** 检查时间单调性、资源引用、边界及交易归属。 */
function checkTimeAndResources(state: AuditState, issues: RpConsistencyIssueDto[]): void {
    if (!state.mechanics) return;
    const resourceIds = new Set(state.mechanics.resources.map((item) => item.id));
    const accountIds = new Set(state.mechanics.accounts.map((item) => item.id));
    const turnIds = new Set((state.turns ?? []).map((item) => item.id));
    for (const account of state.mechanics.accounts) {
        if (!resourceIds.has(account.resourceId)) issues.push(issue("resource.definition_missing", "error", account.id, `资源账户 ${account.id} 引用了不存在的定义 ${account.resourceId}。`));
        const resource = state.mechanics.resources.find((item) => item.id === account.resourceId);
        if ((resource?.min !== null && resource?.min !== undefined && account.value < resource.min) || (resource?.max !== null && resource?.max !== undefined && account.value > resource.max)) {
            issues.push(issue("resource.out_of_bounds", "error", account.id, `资源账户 ${account.id} 的值超出声明边界。`));
        }
    }
    for (const transaction of state.mechanics.transactions) {
        if (!accountIds.has(transaction.accountId)) issues.push(issue("resource.account_missing", "error", transaction.id, `交易引用了不存在的账户 ${transaction.accountId}。`));
        if (!turnIds.has(transaction.turnId)) issues.push(issue("turn.transaction_missing", "error", transaction.id, `交易引用了不存在的回合 ${transaction.turnId}。`));
    }
    for (const record of state.mechanics.timeRecords) {
        try {
            if (BigInt(record.endInstant) < BigInt(record.startInstant)) issues.push(issue("time.reversed", "error", record.turnId, `回合 ${record.turnId} 的结束时间早于开始时间。`));
        } catch {
            issues.push(issue("time.invalid_instant", "error", record.turnId, `回合 ${record.turnId} 使用了非法世界时间。`));
        }
    }
    const duplicateRecords = duplicateValues(state.mechanics.timeRecords.map((item) => item.turnId));
    if (duplicateRecords.length) issues.push(issue("time.duplicate_record", "error", "mechanics.timeRecords", `同一回合存在重复时间结算：${duplicateRecords.join("、")}`));
}

/** 检查层级地图、路线和 NPC 位置引用。 */
function checkMapAndNpcReferences(state: AuditState, issues: RpConsistencyIssueDto[]): void {
    if (!state.map) return;
    const nodeIds = new Set(state.map.nodes.map((item) => item.id));
    for (const node of state.map.nodes) {
        if (state.worldSubjectIds.size && !state.worldSubjectIds.has(node.worldSubjectId)) issues.push(issue("map.world_subject_missing", "error", node.id, `地点 ${node.canonicalName} 缺少 World Engine subject ${node.worldSubjectId}。`));
        if (node.parentId && !nodeIds.has(node.parentId)) issues.push(issue("map.parent_missing", "error", node.id, `地点 ${node.canonicalName} 的父节点不存在。`));
        const seen = new Set<string>([node.id]);
        let parentId = node.parentId;
        while (parentId) {
            if (seen.has(parentId)) {
                issues.push(issue("map.parent_cycle", "error", node.id, `地点 ${node.canonicalName} 的层级形成了环。`));
                break;
            }
            seen.add(parentId);
            parentId = state.map.nodes.find((item) => item.id === parentId)?.parentId ?? null;
        }
    }
    for (const route of state.map.routes) {
        if (!nodeIds.has(route.fromId) || !nodeIds.has(route.toId)) issues.push(issue("map.route_endpoint_missing", "error", route.id, `路线 ${route.label} 引用了不存在的端点。`));
    }
    for (const npc of state.npcs?.npcs ?? []) {
        if (npc.currentLocationId && !nodeIds.has(npc.currentLocationId)) issues.push(issue("npc.location_missing", "warning", npc.id, `NPC ${npc.name} 的当前位置 ${npc.currentLocationId} 不在地图目录中。`));
    }
}

/** 检查事件地点与关注度对象引用。 */
function checkEventAndFocusReferences(state: AuditState, issues: RpConsistencyIssueDto[]): void {
    const nodeIds = new Set(state.map?.nodes.map((item) => item.id) ?? []);
    const eventIds = new Set(state.events?.events.map((item) => item.id) ?? []);
    const npcIds = new Set(state.npcs?.npcs.map((item) => item.id) ?? []);
    const resourceIds = new Set(state.mechanics?.resources.map((item) => item.id) ?? []);
    for (const event of state.events?.events ?? []) {
        if (event.locationId && !nodeIds.has(event.locationId)) issues.push(issue("event.location_missing", "warning", event.id, `事件「${event.title}」引用了不存在的地点 ${event.locationId}。`));
    }
    const activeEvents = (state.events?.events ?? []).filter((event) => ["selected", "active", "suspended"].includes(event.status));
    if (activeEvents.length > 3) issues.push(issue("event.active_limit", "error", "events", `同时处于进行态的事件有 ${activeEvents.length} 个，超过上限 3。`));
    for (const object of state.focus?.objects ?? []) {
        const valid = object.kind === "location" ? nodeIds.has(object.id)
            : object.kind === "npc" ? npcIds.has(object.id)
                : object.kind === "event" ? eventIds.has(object.id)
                    : object.kind === "resource" ? resourceIds.has(object.id) : true;
        if (!valid) issues.push(issue("focus.target_missing", "warning", object.id, `关注度对象 ${object.kind}:${object.id} 已失去目标。`, "none"));
    }
    for (const plan of state.focus?.plans ?? []) {
        const missing = [...plan.independentNpcIds, ...plan.batchNpcIds].filter((id) => !npcIds.has(id));
        if (missing.length) issues.push(issue("focus.plan_npc_missing", "warning", plan.id, `运行计划引用了不存在的 NPC：${[...new Set(missing)].join("、")}`));
    }
}

/** 检查有向关系与三层认知引用，不对内容真伪作自动判断。 */
function checkRelationAndCognitionReferences(state: AuditState, issues: RpConsistencyIssueDto[]): void {
    const actors = new Set([...state.characterIds, ...state.worldSubjectIds]);
    for (const edge of state.relations?.edges ?? []) {
        if (actors.size && (!actors.has(edge.sourceId) || !actors.has(edge.targetId))) issues.push(issue("relation.character_missing", "warning", edge.id, `关系 ${edge.sourceId} → ${edge.targetId} 至少一端不在角色目录中。`));
    }
    const factIds = new Set(state.cognition?.facts.map((item) => item.id) ?? []);
    const oocFactIds = new Set(state.cognition?.oocFacts.map((item) => item.id) ?? []);
    for (const belief of state.cognition?.beliefs ?? []) {
        if (!factIds.has(belief.factId)) issues.push(issue("cognition.fact_missing", "error", belief.id, `角色认知引用了不存在的事实 ${belief.factId}。`));
        if (actors.size && !actors.has(belief.characterId)) issues.push(issue("cognition.character_missing", "warning", belief.id, `认知主体 ${belief.characterId} 不在角色目录中。`));
    }
    for (const knowledge of state.cognition?.oocKnowledge ?? []) {
        if (!factIds.has(knowledge.factId) && !oocFactIds.has(knowledge.factId)) issues.push(issue("cognition.ooc_fact_missing", "error", knowledge.factId, `玩家 OOC 条目缺少事实副本 ${knowledge.factId}。`));
    }
}

/** 检查回合与代码可见 pipeline 的阶段关系。 */
async function checkPipelines(projectRoot: string, turns: RpTurnRecord[], issues: RpConsistencyIssueDto[]): Promise<void> {
    for (const turn of turns) {
        const pipeline = await readChecked(`pipeline:${turn.id}`, () => readRpPipeline(projectRoot, turn.id), issues);
        if (!pipeline) continue;
        if (pipeline.turnId !== turn.id || !RP_PIPELINE_STAGES.includes(pipeline.stage)) issues.push(issue("pipeline.turn_mismatch", "error", turn.id, `回合 ${turn.id} 的 pipeline 标识或阶段非法。`));
        if (turn.status === "committed" && !pipeline.completedAt) issues.push(issue("pipeline.incomplete_commit", "error", turn.id, `回合 ${turn.id} 已 committed，但 pipeline 尚未完成。`));
        if (turn.status !== "committed" && pipeline.completedAt) issues.push(issue("pipeline.premature_complete", "error", turn.id, `回合 ${turn.id} 尚未 committed，但 pipeline 已标记完成。`));
        if (turn.status === "committed" && pipeline.narrative?.prosePath !== turn.prosePath) issues.push(issue(
            "narrative.prose_mismatch", "error", turn.id, `回合 ${turn.id} 的叙事产物与 committed 正文路径不一致。`, "player_confirmation",
            ["以 committed 正文为准并修订 pipeline", "以 pipeline 叙事为准并重新提交正文", "回滚到提交前切片"],
        ));
    }
}

/** 使用 SQLite 原生检查确认 World Engine 真相源；deep 额外运行完整 integrity_check 与外键检查。 */
async function checkWorldDatabase(projectRoot: string, intake: RpIntakeState | null, level: RpConsistencyLevelDto, issues: RpConsistencyIssueDto[], subjectIds: Set<string>): Promise<void> {
    const databasePath = join(projectRoot, ".nbook/world-rp.sqlite");
    try {
        await access(databasePath);
    } catch {
        if (intake?.phase === "active") issues.push(issue("world.database_missing", "error", "world", "冒险已激活，但 RP World Engine 数据库不存在。"));
        return;
    }
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        const check = await client.execute(level === "deep" ? "PRAGMA integrity_check" : "PRAGMA quick_check");
        const results = check.rows.map((row) => String(Object.values(row)[0] ?? ""));
        if (results.some((value) => value.toLowerCase() !== "ok")) issues.push(issue("world.integrity_failed", "error", "world", `SQLite 完整性检查失败：${results.join("；")}`));
        if (level === "deep") {
            const foreignKeys = await client.execute("PRAGMA foreign_key_check");
            if (foreignKeys.rows.length) issues.push(issue("world.foreign_key_failed", "error", "world", `World Engine 存在 ${foreignKeys.rows.length} 条外键异常。`));
        }
        const subjects = await client.execute(`SELECT "id" FROM "WorldSubject"`);
        for (const row of subjects.rows) if (typeof row.id === "string") subjectIds.add(row.id);
    } catch (error) {
        issues.push(issue("world.database_unreadable", "error", "world", `World Engine 数据库检查失败：${errorMessage(error)}`));
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
}

/** 创建默认需玩家确认的一致性问题。 */
function issue(
    code: string,
    severity: RpConsistencyIssueDto["severity"],
    scope: string,
    message: string,
    repair: RpConsistencyIssueDto["repair"] = "player_confirmation",
    resolutionOptions?: string[],
): RpConsistencyIssueDto {
    return {code, severity, scope, message, repair, ...(resolutionOptions ? {resolutionOptions} : {})};
}

/** 返回集合中的重复值。 */
function duplicateValues(values: string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const value of values) seen.has(value) ? duplicates.add(value) : seen.add(value);
    return [...duplicates];
}

/** 原子写入最新审计报告。 */
async function writeJsonAtomic(path: string, value: RpConsistencyReportDto): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    await rename(temporary, path);
}

/** 同一 Project Workspace 的审计串行执行，避免两次安全修复互相覆盖。 */
async function withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    locks.set(key, tail);
    await previous;
    try {
        return await action();
    } finally {
        release();
        if (locks.get(key) === tail) locks.delete(key);
    }
}

/** 将外部读库或 schema 异常转成稳定文本。 */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 判断外部持久文件是否不存在。 */
function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}
