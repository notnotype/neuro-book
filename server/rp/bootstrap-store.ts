import {createClient} from "@libsql/client";
import fs from "node:fs/promises";
import path from "node:path";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {readCharacterRegistry, readMood, readSoul} from "nbook/server/rp/character-store";
import {readRpEventState} from "nbook/server/rp/event-store";
import {
    assertRpBootstrapStage,
    completeRpBootstrap,
    completeRpBootstrapStage,
    failRpBootstrap,
    readRpIntake,
    type RpBootstrapStage,
    type RpIntakeState,
} from "nbook/server/rp/intake-store";
import {readRpMapState} from "nbook/server/rp/map-store";
import {readRpNpcState} from "nbook/server/rp/npc-store";
import {WorldCalendarLoader} from "nbook/server/world-engine/calendar";
import {WorldSchemaLoader} from "nbook/server/world-engine/schema-loader";
import {WorldEngineRepository} from "nbook/server/world-engine/world-engine.repository";
import {PROJECT_RP_WORLD_DATABASE_RELATIVE_PATH, toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

export const RP_OPENING_STAGING_PATH = "rp/bootstrap/staging/opening-prose.md";
export const RP_OPENING_PROSE_PATH = "rp/ticks/000000-initial-state/prose.md";

export type RpBootstrapCalendarPreset = "gregorian" | "simple";

/**
 * 用服务端持有的受信模板建立可运行的 RP Schema/Calendar。
 * Agent 只选择历法预设与纪元名，不再直接拼装 TypeScript 配置合同。
 */
export async function initializeRpBootstrapConfig(
    projectRoot: string,
    input: {calendarPreset: RpBootstrapCalendarPreset; eraBefore?: string; eraAfter?: string},
): Promise<RpIntakeState> {
    await assertRpBootstrapStage(projectRoot, ["config"]);
    const schemaPath = path.join(projectRoot, "rp/world-engine/schema/index.ts");
    const calendarPath = path.join(projectRoot, "rp/world-engine/calendar.ts");
    await Promise.all([
        fs.mkdir(path.dirname(schemaPath), {recursive: true}),
        fs.mkdir(path.dirname(calendarPath), {recursive: true}),
    ]);
    await Promise.all([
        fs.writeFile(schemaPath, RP_BOOTSTRAP_SCHEMA_SOURCE, "utf-8"),
        fs.writeFile(calendarPath, calendarSource(input), "utf-8"),
    ]);

    // 写入完成即用生产 loader 验证；模板或 loader 合同漂移会在本次工具调用内暴露。
    const configRoot = absoluteFsPath(path.join(projectRoot, "rp"));
    await new WorldSchemaLoader().load(configRoot);
    await new WorldCalendarLoader().load(configRoot);
    return await readRpIntake(projectRoot);
}

/** 校验当前 Bootstrap 阶段并持久化相邻阶段推进；失败会停留在原阶段并记录原因。 */
export async function checkpointRpBootstrap(projectRoot: string, stage: RpBootstrapStage): Promise<RpIntakeState> {
    const state = await readRpIntake(projectRoot);
    if (state.phase !== "bootstrapping" || state.bootstrap.stage !== stage) {
        throw new Error(`Bootstrap 当前阶段为 ${state.bootstrap.stage ?? state.phase}，不能校验 ${stage}。`);
    }
    try {
        await validateStage(projectRoot, stage);
        return await completeRpBootstrapStage(projectRoot, stage);
    } catch (error) {
        const message = errorMessage(error);
        await failRpBootstrap(projectRoot, message);
        throw new Error(`Bootstrap ${stage} 校验失败：${message}`);
    }
}

/** 对所有 Bootstrap 产物重新验收，发布开场正文后激活冒险。 */
export async function activateRpAdventure(projectRoot: string): Promise<RpIntakeState> {
    const state = await readRpIntake(projectRoot);
    if (state.phase === "active") return state;
    if (state.phase !== "bootstrapping" || state.bootstrap.stage !== "ready_to_activate") {
        throw new Error(`无法激活 RP：Bootstrap 当前阶段为 ${state.bootstrap.stage ?? state.phase}。`);
    }
    try {
        for (const stage of ["config", "world", "map", "characters", "opening_event", "narrative"] as const) {
            await validateStage(projectRoot, stage);
        }
        await publishOpeningProse(projectRoot);
        try {
            return await completeRpBootstrap(projectRoot);
        } catch (error) {
            await fs.rename(path.join(projectRoot, RP_OPENING_PROSE_PATH), path.join(projectRoot, RP_OPENING_STAGING_PATH));
            throw error;
        }
    } catch (error) {
        const message = errorMessage(error);
        const latest = await readRpIntake(projectRoot);
        if (latest.phase === "bootstrapping") await failRpBootstrap(projectRoot, message);
        throw new Error(`RP 激活验收失败：${message}`);
    }
}

/** 按阶段执行真实数据校验，而不是相信 Agent 的完成声明。 */
async function validateStage(projectRoot: string, stage: RpBootstrapStage): Promise<void> {
    if (stage === "config") return validateConfig(projectRoot);
    if (stage === "world") return validateWorld(projectRoot);
    if (stage === "map") return validateMap(projectRoot);
    if (stage === "characters") return validateCharacters(projectRoot);
    if (stage === "opening_event") return validateOpeningEvent(projectRoot);
    await validateNarrative(projectRoot);
}

/** 配置阶段要求正式材料存在，且 Schema/Calendar 均能由生产 loader 加载。 */
async function validateConfig(projectRoot: string): Promise<void> {
    await requirePath(path.join(projectRoot, "rp/manual/README.md"), "缺少 rp/manual/README.md");
    await requirePath(path.join(projectRoot, "rp/lorebook"), "缺少 rp/lorebook/ 世界设定目录");
    await requirePath(path.join(projectRoot, "rp/world-engine/schema/index.ts"), "缺少 rp/world-engine/schema/index.ts");
    await requirePath(path.join(projectRoot, "rp/world-engine/calendar.ts"), "缺少 rp/world-engine/calendar.ts");
    const configRoot = absoluteFsPath(path.join(projectRoot, "rp"));
    const schema = await new WorldSchemaLoader().load(configRoot);
    const requiredTypes = ["world", "character", "location"].filter((type) => !(type in schema.subjectTypes));
    if (requiredTypes.length) throw new Error(`WorldSchema 缺少必要 subject 类型：${requiredTypes.join("、")}`);
    const worldAttrs = schema.subjectTypes.world?.attrs ?? {};
    if (Object.keys(worldAttrs).length === 0) throw new Error("WorldSchema 的 world 类型没有可写属性");
    const requiredAttrs: Array<{type: "character" | "location"; attrs: string[]}> = [
        {type: "character", attrs: ["位置", "关系", "secret"]},
        {type: "location", attrs: ["描述", "连接"]},
    ];
    for (const requirement of requiredAttrs) {
        const attrs = schema.subjectTypes[requirement.type]?.attrs ?? {};
        const missing = requirement.attrs.filter((attr) => !(attr in attrs));
        if (missing.length) throw new Error(`WorldSchema 的 ${requirement.type} 类型缺少必要属性：${missing.join("、")}`);
    }
    await new WorldCalendarLoader().load(configRoot);
}

/** 世界阶段要求 RP 独立数据库拥有基础主体与至少一个包含 patch 的初始切片。 */
async function validateWorld(projectRoot: string): Promise<void> {
    const databasePath = path.join(projectRoot, PROJECT_RP_WORLD_DATABASE_RELATIVE_PATH);
    await requirePath(databasePath, `缺少 ${PROJECT_RP_WORLD_DATABASE_RELATIVE_PATH}`);
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        const repository = new WorldEngineRepository(client);
        const subjects = await repository.listSubjects();
        for (const type of ["world", "character", "location"]) {
            if (!subjects.some((subject) => subject.type === type)) throw new Error(`RP 世界线缺少 ${type} subject`);
        }
        const slices = await repository.listSlices({limit: 1, withPatches: true});
        if (!slices.some((slice) => (slice.patches?.length ?? 0) > 0)) throw new Error("RP 世界线缺少包含状态 patch 的初始切片");
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
}

/** 地图阶段要求至少一个稳定节点，且每个节点都能对应 World Engine location subject。 */
async function validateMap(projectRoot: string): Promise<void> {
    const map = await readRpMapState(projectRoot);
    if (map.nodes.length === 0) throw new Error("初始地图没有已固化地点节点");
    const databasePath = path.join(projectRoot, PROJECT_RP_WORLD_DATABASE_RELATIVE_PATH);
    const client = createClient({url: toSqliteFileUrl(databasePath)});
    try {
        const locations = await new WorldEngineRepository(client).listSubjects({type: "location"});
        const locationIds = new Set(locations.map((subject) => subject.id));
        const missing = map.nodes.filter((node) => !locationIds.has(node.worldSubjectId)).map((node) => node.id);
        if (missing.length) throw new Error(`地图节点缺少对应 location subject：${missing.join("、")}`);
    } finally {
        client.close();
        collectReleasedSqliteHandles({force: true});
    }
}

/**
 * 角色阶段要求已建档角色具备人设与心境。
 *
 * NPC roster 可以为空：未具名群演按生命周期不入 roster，独角开场也不应被迫
 * 伪造 NPC。若已有 roster，readRpNpcState 仍会完成结构校验。
 */
async function validateCharacters(projectRoot: string): Promise<void> {
    const registry = await readCharacterRegistry(projectRoot);
    if (registry.length === 0) throw new Error("角色注册表为空");
    for (const character of registry) {
        const [soul, mood] = await Promise.all([readSoul(projectRoot, character.id), readMood(projectRoot, character.id)]);
        if (!soul.trim() || soul.includes("第一人称扮演手册，见 subject-creation-guide")) throw new Error(`角色 ${character.name} 尚未完成人设`);
        if (!mood.trim() || mood.includes("当前情绪、短期意图、悬着的疑问；每 Tick 更新")) throw new Error(`角色 ${character.name} 尚未完成开局心境`);
    }
    await readRpNpcState(projectRoot);
}

/** 开场事件阶段必须存在已经启动的 opening 事件。 */
async function validateOpeningEvent(projectRoot: string): Promise<void> {
    const events = await readRpEventState(projectRoot);
    if (!events.events.some((event) => event.origin === "opening" && event.status === "active")) {
        throw new Error("缺少已激活的开场事件");
    }
}

/** 叙事阶段只接受暂存正文，未激活前不得把正文放入正式 Tick。 */
async function validateNarrative(projectRoot: string): Promise<void> {
    const source = await fs.readFile(path.join(projectRoot, RP_OPENING_STAGING_PATH), "utf-8");
    if (!source.trim()) throw new Error("开场正文暂存文件为空");
}

/** 将暂存开场正文发布到 Tick 000000；正式文件已存在时拒绝覆盖。 */
async function publishOpeningProse(projectRoot: string): Promise<void> {
    const stagingPath = path.join(projectRoot, RP_OPENING_STAGING_PATH);
    const prosePath = path.join(projectRoot, RP_OPENING_PROSE_PATH);
    await fs.mkdir(path.dirname(prosePath), {recursive: true});
    try {
        await fs.access(prosePath);
        throw new Error(`正式开场正文已存在，拒绝覆盖：${RP_OPENING_PROSE_PATH}`);
    } catch (error) {
        if (!isNotFound(error)) throw error;
    }
    await fs.rename(stagingPath, prosePath);
}

/** 要求路径存在，并把底层 ENOENT 收敛为玩家可理解的问题。 */
async function requirePath(target: string, message: string): Promise<void> {
    try {
        await fs.access(target);
    } catch (error) {
        if (isNotFound(error)) throw new Error(message);
        throw error;
    }
}

/** 提取任意异常的稳定展示文本。 */
function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

/** 判断 Node 文件不存在错误。 */
function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}

/** RP 开团可直接运行的最小 Zod Schema；故事特有资源继续由独立 RP store 承载。 */
const RP_BOOTSTRAP_SCHEMA_SOURCE = `import {z} from "zod";

/** 引用其他 subject；持久值形如 subject://some-id。 */
function Ref(targetType: string) {
    return z.string().regex(/^subject:\\/\\/[\\w-]+$/).describe(\`ref:\${targetType}\`);
}

export const WorldSchema = {
    world: z.object({
        名称: z.string().default("").describe("世界名称"),
        概况: z.string().default("").describe("当前公开概况"),
        事件: z.array(z.string()).default([]).describe("已发生的世界事件"),
    }),
    character: z.object({
        姓名: z.string().default("").describe("角色显示名"),
        位置: Ref("location").optional().describe("当前位置"),
        持有物: z.array(z.string()).default([]).describe("随身物品"),
        关系: z.array(z.object({
            对象: Ref("character"),
            类型: z.string(),
            好感: z.number().optional(),
        })).default([]).describe("人际关系"),
        secret: z.record(z.string(), z.string()).optional().describe("god-view 隐藏状态"),
    }),
    location: z.object({
        名称: z.string().default("").describe("地点显示名"),
        描述: z.string().default("").describe("环境要点"),
        连接: z.array(z.object({
            目标: Ref("location"),
            方向: z.string().optional(),
            距离: z.string().optional(),
        })).default([]).describe("通路"),
    }),
} as const;
`;

/** 根据受限参数生成历法配置，避免模型发明 loader 不支持的字段。 */
function calendarSource(input: {calendarPreset: RpBootstrapCalendarPreset; eraBefore?: string; eraAfter?: string}): string {
    const eraBefore = JSON.stringify(input.eraBefore?.trim() || (input.calendarPreset === "gregorian" ? "公元前" : "旧纪元"));
    const eraAfter = JSON.stringify(input.eraAfter?.trim() || (input.calendarPreset === "gregorian" ? "公元" : "新纪元"));
    if (input.calendarPreset === "gregorian") {
        return `export default {
    type: "gregorian",
    eraBefore: ${eraBefore},
    eraAfter: ${eraAfter},
    format: "{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}",
};
`;
    }
    return `export default {
    type: "simple",
    eraBefore: ${eraBefore},
    eraAfter: ${eraAfter},
    baseUnit: "second",
    units: [
        {name: "minute", parent: "second", ratio: 60},
        {name: "hour", parent: "minute", ratio: 60},
        {name: "day", parent: "hour", ratio: 24},
        {name: "month", parent: "day", ratio: 30},
        {name: "year", parent: "month", ratio: 12},
    ],
    format: "{eraName}{year}年{month}月{day}日 {hour:02}:{minute:02}",
};
`;
}
