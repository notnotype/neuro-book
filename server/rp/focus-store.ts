import {randomUUID} from "node:crypto";
import {appendFile, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {z} from "zod";
import {readRpEventState} from "nbook/server/rp/event-store";
import {readRpIntake} from "nbook/server/rp/intake-store";
import {readRpNpcState} from "nbook/server/rp/npc-store";

export const RP_FOCUS_STATE_PATH = ".nbook/rp/runtime/focus/state.json";
export const RP_FOCUS_LEDGER_PATH = ".nbook/rp/runtime/focus-ledger.jsonl";
export const RP_LONG_JUMP_ROOT = ".nbook/rp/runtime/long-jumps";

export const RP_FOCUS_LEVELS = ["current", "active_background", "low_frequency", "dormant"] as const;
export const RP_RUN_INTENSITIES = ["light", "standard", "deep"] as const;

export type RpFocusLevel = typeof RP_FOCUS_LEVELS[number];
export type RpRunIntensity = typeof RP_RUN_INTENSITIES[number];
export type RpFocusKind = "location" | "npc" | "event" | "faction" | "plan" | "resource";

export type RpFocusObject = {
    id: string;
    kind: RpFocusKind;
    level: RpFocusLevel;
    pinned: boolean;
    reason: string;
    updatedTick: number;
    updatedAt: string;
};

export type RpRuntimePlan = {
    id: string;
    turnId: string;
    intensity: RpRunIntensity;
    longJump: boolean;
    startInstant: string;
    endInstant: string;
    deterministicModules: string[];
    independentNpcIds: string[];
    batchNpcIds: string[];
    backgroundObjectIds: string[];
    dormantObjectIds: string[];
    remoteSceneBudget: number;
    createdAt: string;
};

export type RpFocusState = {
    schemaVersion: 1;
    intensity: RpRunIntensity;
    objects: RpFocusObject[];
    plans: RpRuntimePlan[];
    updatedAt: string;
};

const FocusObjectSchema: z.ZodType<RpFocusObject> = z.object({
    id: z.string(), kind: z.enum(["location", "npc", "event", "faction", "plan", "resource"]), level: z.enum(RP_FOCUS_LEVELS), pinned: z.boolean(), reason: z.string(),
    updatedTick: z.number().int().nonnegative(), updatedAt: z.string(),
});
const RuntimePlanSchema: z.ZodType<RpRuntimePlan> = z.object({
    id: z.string(), turnId: z.string(), intensity: z.enum(RP_RUN_INTENSITIES), longJump: z.boolean(),
    startInstant: z.string().regex(/^-?\d+$/), endInstant: z.string().regex(/^-?\d+$/),
    deterministicModules: z.array(z.string()), independentNpcIds: z.array(z.string()), batchNpcIds: z.array(z.string()), backgroundObjectIds: z.array(z.string()), dormantObjectIds: z.array(z.string()),
    remoteSceneBudget: z.number().int().nonnegative(), createdAt: z.string(),
});
const StateSchema: z.ZodType<RpFocusState> = z.object({schemaVersion: z.literal(1), intensity: z.enum(RP_RUN_INTENSITIES), objects: z.array(FocusObjectSchema), plans: z.array(RuntimePlanSchema), updatedAt: z.string()});

const locks = new Map<string, Promise<void>>();

/** 读取持久运行强度与关注度；每轮直接读取，不需要为了切换档位调用模型。 */
export async function readRpFocusState(projectRoot: string): Promise<RpFocusState> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(projectRoot, RP_FOCUS_STATE_PATH), "utf-8"));
        return StateSchema.parse(parsed);
    } catch (error) {
        if (!isNotFound(error)) throw error;
        return emptyState();
    }
}

/** UI/leader 直接写持久变量；档位只影响远端丰富度。 */
export async function setRpRunIntensity(projectRoot: string, intensity: RpRunIntensity): Promise<RpFocusState> {
    return mutate(projectRoot, "set_intensity", (state) => {
        state.intensity = intensity;
        return {value: state, detail: {intensity}};
    });
}

/** 玩家可手动固定关注度；pinned 变更必须来自真实玩家审批。 */
export async function setRpObjectFocus(projectRoot: string, input: {
    id: string;
    kind: RpFocusKind;
    level: RpFocusLevel;
    pinned: boolean;
    playerApproved: boolean;
    reason: string;
    tick: number;
}): Promise<RpFocusObject> {
    if (!input.playerApproved) throw new Error("手动固定关注度必须获得玩家确认。");
    return mutate(projectRoot, "set_focus", (state, now) => {
        const object = upsertFocus(state, now, input);
        object.pinned = input.pinned;
        return {value: object, detail: {objectId: object.id, level: object.level, pinned: object.pinned}};
    });
}

/** world 自动平衡：当前场景最高，硬性/后台对象次之，主要角色至少低频；玩家 pinned 项不改。 */
export async function rebalanceRpFocus(projectRoot: string, input: {
    tick: number;
    current: Array<{id: string; kind: RpFocusKind; reason: string}>;
    activeBackground: Array<{id: string; kind: RpFocusKind; reason: string}>;
    lowFrequency: Array<{id: string; kind: RpFocusKind; reason: string}>;
}): Promise<RpFocusState> {
    const npcState = await readRpNpcState(projectRoot);
    return mutate(projectRoot, "rebalance", (state, now) => {
        const requested = new Map<string, {kind: RpFocusKind; level: RpFocusLevel; reason: string}>();
        for (const item of input.lowFrequency) requested.set(item.id, {...item, level: "low_frequency"});
        for (const item of input.activeBackground) requested.set(item.id, {...item, level: "active_background"});
        for (const item of input.current) requested.set(item.id, {...item, level: "current"});
        for (const npc of npcState.npcs.filter((item) => item.tier === "major" || item.tier === "major_inactive")) {
            if (!requested.has(npc.id)) requested.set(npc.id, {kind: "npc", level: "low_frequency", reason: "主要角色最低关注度"});
        }
        for (const existing of state.objects) {
            if (!existing.pinned && !requested.has(existing.id)) {
                existing.level = "dormant";
                existing.reason = "本轮未被当前场景、后台事件或主要角色规则命中";
                existing.updatedTick = requireTick(input.tick);
                existing.updatedAt = now;
            }
        }
        for (const [id, item] of requested) {
            const existing = state.objects.find((object) => object.id === id);
            if (existing?.pinned) continue;
            upsertFocus(state, now, {id, kind: item.kind, level: item.level, pinned: false, reason: item.reason, tick: input.tick});
        }
        return {value: state, detail: {tick: input.tick, current: input.current.map((item) => item.id), activeBackground: input.activeBackground.map((item) => item.id)}};
    });
}

/**
 * 生成确定性运行计划。强度只改变远端场景预算和后台独立判断数量；当前/直连 NPC、硬性事件与规则结算永不降级。
 */
export async function planRpRuntime(projectRoot: string, input: {
    turnId: string;
    longJump: boolean;
    startInstant: string;
    endInstant: string;
    currentNpcIds: string[];
    directInteractionNpcIds: string[];
}): Promise<RpRuntimePlan> {
    const startInstant = requireInstant(input.startInstant, "开始 Instant");
    const endInstant = requireInstant(input.endInstant, "结束 Instant");
    if (BigInt(endInstant) < BigInt(startInstant)) throw new Error("结束 Instant 不能早于开始 Instant。");
    if (input.longJump) {
        const {runRpConsistencyCheck} = await import("nbook/server/rp/consistency-store");
        const consistency = await runRpConsistencyCheck(projectRoot, "standard", true);
        if (consistency.status === "blocked") throw new Error(`长跳前一致性检查未通过：${consistency.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join("；")}`);
    }
    const [focus, npcState, eventState] = await Promise.all([readRpFocusState(projectRoot), readRpNpcState(projectRoot), readRpEventState(projectRoot)]);
    const existing = focus.plans.find((plan) => plan.turnId === input.turnId);
    if (existing) return existing;
    const mandatoryNpcIds = normalizeIds([...input.currentNpcIds, ...input.directInteractionNpcIds]);
    const activeBackgroundIds = focus.objects.filter((object) => object.level === "active_background").map((object) => object.id);
    const majorCandidates = npcState.npcs.filter((npc) => ["major", "resident"].includes(npc.tier) && !mandatoryNpcIds.includes(npc.id));
    const independentLimit = focus.intensity === "light" ? 0 : focus.intensity === "standard" ? 3 : 8;
    const independentNpcIds = normalizeIds([...mandatoryNpcIds, ...majorCandidates.filter((npc) => {
        const object = focus.objects.find((item) => item.id === npc.id);
        return object?.level === "current" || object?.level === "active_background";
    }).slice(0, independentLimit).map((npc) => npc.id)]);
    const batchNpcIds = npcState.npcs.filter((npc) => npc.tier === "named" && !independentNpcIds.includes(npc.id)).map((npc) => npc.id);
    const dormantObjectIds = focus.objects.filter((object) => object.level === "dormant").map((object) => object.id);
    const hardEventIds = eventState.events.filter((event) => event.hard && ["active", "suspended"].includes(event.status)).map((event) => event.id);
    const remoteSceneBudget = focus.intensity === "light" ? 0 : focus.intensity === "standard" ? 2 : 6;
    const now = new Date().toISOString();
    const plan: RpRuntimePlan = {
        id: `runtime-plan-${randomUUID()}`,
        turnId: requireText(input.turnId, "turn id"),
        intensity: focus.intensity,
        longJump: input.longJump,
        startInstant,
        endInstant,
        deterministicModules: ["time", "resources", "cycles", "hard_events", "candidate_expiry", "explicit_probability"],
        independentNpcIds,
        batchNpcIds,
        backgroundObjectIds: normalizeIds([...activeBackgroundIds, ...hardEventIds]),
        dormantObjectIds,
        remoteSceneBudget,
        createdAt: now,
    };
    return mutate(projectRoot, "plan_runtime", (state) => {
        const duplicate = state.plans.find((item) => item.turnId === plan.turnId);
        if (duplicate) return {value: duplicate, detail: {turnId: plan.turnId, duplicate: true}};
        state.plans.push(plan);
        return {value: plan, detail: {turnId: plan.turnId, intensity: plan.intensity, independentNpcIds, batchNpcCount: batchNpcIds.length, remoteSceneBudget}};
    });
}

/** 长跳只保存一次阶段摘要，不逐日生成 Tick。 */
export async function recordRpLongJumpSummary(projectRoot: string, turnId: string, input: {
    startTime: string;
    endTime: string;
    deterministicSummary: string;
    characterSummary: string;
    worldSummary: string;
}): Promise<{turnId: string; path: string}> {
    await assertAdventureRunning(projectRoot);
    const filePath = join(projectRoot, RP_LONG_JUMP_ROOT, `${safeId(turnId, "turn id")}.json`);
    return withLock(filePath, async () => {
        try {
            await readFile(filePath, "utf-8");
            return {turnId, path: `${RP_LONG_JUMP_ROOT}/${safeId(turnId, "turn id")}.json`};
        } catch (error) {
            if (!isNotFound(error)) throw error;
        }
        const value = {
            schemaVersion: 1,
            turnId,
            startTime: requireText(input.startTime, "长跳开始时间"),
            endTime: requireText(input.endTime, "长跳结束时间"),
            deterministicSummary: requireText(input.deterministicSummary, "确定性结算摘要"),
            characterSummary: requireText(input.characterSummary, "角色推演摘要"),
            worldSummary: requireText(input.worldSummary, "世界推演摘要"),
            createdAt: new Date().toISOString(),
        };
        await writeJsonAtomic(filePath, value);
        await appendLedger(projectRoot, {operation: "record_long_jump", turnId, at: value.createdAt});
        return {turnId, path: `${RP_LONG_JUMP_ROOT}/${safeId(turnId, "turn id")}.json`};
    });
}

function upsertFocus(state: RpFocusState, now: string, input: {
    id: string; kind: RpFocusKind; level: RpFocusLevel; pinned: boolean; reason: string; tick: number;
}): RpFocusObject {
    const id = safeId(input.id, "关注对象 id");
    let object = state.objects.find((item) => item.id === id);
    const value: RpFocusObject = {
        id,
        kind: input.kind,
        level: input.level,
        pinned: input.pinned,
        reason: requireText(input.reason, "关注度原因"),
        updatedTick: requireTick(input.tick),
        updatedAt: now,
    };
    if (object) state.objects[state.objects.indexOf(object)] = value;
    else state.objects.push(value);
    object = value;
    return object;
}

function normalizeIds(values: string[]): string[] {
    return [...new Set(values.map((value) => safeId(value, "对象 id")))];
}

function safeId(value: string, label: string): string {
    const normalized = value.trim();
    if (!/^[\p{L}\p{N}_.:-]+$/u.test(normalized)) throw new Error(`非法${label}：${value}`);
    return normalized;
}

function requireText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label}不能为空。`);
    return normalized;
}

/** Runtime plan 只保存 World Engine 原始 Instant，禁止混入格式化日历文本。 */
function requireInstant(value: string, label: string): string {
    const normalized = value.trim();
    if (!/^-?\d+$/.test(normalized)) throw new Error(`${label}必须是 bigint 十进制字符串，不能使用格式化日历时间：${value}`);
    return normalized;
}

function requireTick(tick: number): number {
    if (!Number.isInteger(tick) || tick < 0) throw new Error("tick 必须是非负整数。");
    return tick;
}

function emptyState(): RpFocusState {
    return {schemaVersion: 1, intensity: "standard", objects: [], plans: [], updatedAt: new Date(0).toISOString()};
}

async function mutate<T>(projectRoot: string, operation: string, action: (state: RpFocusState, now: string) => {value: T; detail: object}): Promise<T> {
    await assertAdventureRunning(projectRoot);
    const path = join(projectRoot, RP_FOCUS_STATE_PATH);
    return withLock(path, async () => {
        const state = await readRpFocusState(projectRoot);
        const now = new Date().toISOString();
        const result = action(state, now);
        state.updatedAt = now;
        await writeAtomic(path, state);
        await appendLedger(projectRoot, {operation, at: now, ...result.detail});
        return result.value;
    });
}

async function assertAdventureRunning(projectRoot: string): Promise<void> {
    const intake = await readRpIntake(projectRoot);
    if (intake.phase !== "bootstrapping" && intake.phase !== "active") throw new Error(`RP 关注度系统尚不可写：当前冒险阶段为 ${intake.phase}。`);
}

async function writeAtomic(path: string, state: RpFocusState): Promise<void> {
    await writeJsonAtomic(path, state);
}

async function writeJsonAtomic(path: string, value: object): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    await rename(temporary, path);
}

async function appendLedger(projectRoot: string, value: object): Promise<void> {
    const path = join(projectRoot, RP_FOCUS_LEDGER_PATH);
    await mkdir(dirname(path), {recursive: true});
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf-8");
}

async function withLock<T>(path: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(path) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    locks.set(path, tail);
    await previous;
    try {
        return await action();
    } finally {
        release();
        if (locks.get(path) === tail) locks.delete(path);
    }
}

function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}
