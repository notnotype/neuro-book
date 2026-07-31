import {randomUUID} from "node:crypto";
import {appendFile, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {z} from "zod";
import {commitTickMemory, ensureRpCharacter, safeCharacterId} from "nbook/server/rp/character-store";
import {assertRpBootstrapStage} from "nbook/server/rp/intake-store";

export const RP_NPC_STATE_PATH = ".nbook/rp/runtime/npcs/state.json";
export const RP_NPC_LEDGER_PATH = ".nbook/rp/runtime/npc-ledger.jsonl";
export const DEFAULT_ACTIVE_MAJOR_LIMIT = 8;

export type RpNpcTier = "named" | "resident" | "major" | "major_inactive";
export type RpNpcOrigin = "extra_named" | "world" | "player" | "import";
export type RpNpcResourceStatus = "none" | "pending" | "ready";
export type RpNpcSuggestionStatus = "open" | "accepted" | "rejected";

/** NPC roster 是角色生命周期目录；major 的完整人设与主观记忆仍存放在 rp/characters/。 */
export type RpNpcRecord = {
    id: string;
    name: string;
    aliases: string[];
    tier: RpNpcTier;
    origin: RpNpcOrigin;
    /** ally/enemy/rival 等都可使用；敌对身份不阻止擢升。 */
    narrativeRole: string;
    playerSummary: string;
    /** GM 用的人设草案；玩家提供的人设也先保存在这里，升 major 时写入 soul.md。 */
    personaSummary: string;
    household: string;
    firstNamedTick: number;
    lastSeenTick: number;
    currentLocationId: string | null;
    inactiveReason: string | null;
    resourceStatus: RpNpcResourceStatus;
    actorSession: "lazy";
    createdAt: string;
    updatedAt: string;
};

export type RpNpcPromotion = {
    id: string;
    npcId: string;
    fromTier: RpNpcTier;
    toTier: RpNpcTier;
    reason: string;
    playerApproved: true;
    tick: number;
    historySources: string[];
    createdAt: string;
};

export type RpNpcSuggestion = {
    id: string;
    npcId: string;
    targetTier: "resident" | "major";
    reason: string;
    evidence: string[];
    status: RpNpcSuggestionStatus;
    createdAt: string;
    updatedAt: string;
};

export type RpNpcState = {
    schemaVersion: 1;
    activeMajorLimit: number;
    npcs: RpNpcRecord[];
    promotions: RpNpcPromotion[];
    suggestions: RpNpcSuggestion[];
    updatedAt: string;
};

export type RpNpcMemoryBackfill = {
    tick: number;
    summaryLine: string;
    detail: string;
    time?: string;
    participants?: string[];
    sourceRef: string;
};

const NpcSchema: z.ZodType<RpNpcRecord> = z.object({
    id: z.string(), name: z.string(), aliases: z.array(z.string()), tier: z.enum(["named", "resident", "major", "major_inactive"]),
    origin: z.enum(["extra_named", "world", "player", "import"]), narrativeRole: z.string(), playerSummary: z.string(), personaSummary: z.string(), household: z.string(),
    firstNamedTick: z.number().int().nonnegative(), lastSeenTick: z.number().int().nonnegative(), currentLocationId: z.string().nullable(), inactiveReason: z.string().nullable(),
    resourceStatus: z.enum(["none", "pending", "ready"]), actorSession: z.literal("lazy"), createdAt: z.string(), updatedAt: z.string(),
});
const PromotionSchema: z.ZodType<RpNpcPromotion> = z.object({
    id: z.string(), npcId: z.string(), fromTier: z.enum(["named", "resident", "major", "major_inactive"]), toTier: z.enum(["named", "resident", "major", "major_inactive"]),
    reason: z.string(), playerApproved: z.literal(true), tick: z.number().int().nonnegative(), historySources: z.array(z.string()), createdAt: z.string(),
});
const SuggestionSchema: z.ZodType<RpNpcSuggestion> = z.object({
    id: z.string(), npcId: z.string(), targetTier: z.enum(["resident", "major"]), reason: z.string(), evidence: z.array(z.string()),
    status: z.enum(["open", "accepted", "rejected"]), createdAt: z.string(), updatedAt: z.string(),
});
const StateSchema: z.ZodType<RpNpcState> = z.object({
    schemaVersion: z.literal(1), activeMajorLimit: z.number().int().positive(), npcs: z.array(NpcSchema), promotions: z.array(PromotionSchema), suggestions: z.array(SuggestionSchema), updatedAt: z.string(),
});

const locks = new Map<string, Promise<void>>();

/** 读取完整 NPC roster。 */
export async function readRpNpcState(projectRoot: string): Promise<RpNpcState> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(projectRoot, RP_NPC_STATE_PATH), "utf-8"));
        return StateSchema.parse(parsed);
    } catch (error) {
        if (!isNotFound(error)) throw error;
        return emptyState();
    }
}

/** 玩家侧只展示可公开摘要、层级和非阻塞擢升建议。 */
export async function readRpPlayerRoster(projectRoot: string): Promise<{
    activeMajorLimit: number;
    npcs: PlayerNpcRecord[];
    suggestions: RpNpcSuggestion[];
}> {
    const state = await readRpNpcState(projectRoot);
    return {
        activeMajorLimit: state.activeMajorLimit,
        npcs: state.npcs.map((npc) => ({
            id: npc.id, name: npc.name, tier: npc.tier, narrativeRole: npc.narrativeRole,
            playerSummary: npc.playerSummary, lastSeenTick: npc.lastSeenTick, currentLocationId: npc.currentLocationId,
        })),
        suggestions: state.suggestions.filter((suggestion) => suggestion.status === "open"),
    };
}

/** 群演一旦在叙事中说出姓名，立即登记最低具名记录；重复登记按 id 幂等更新出场信息。 */
export async function registerNamedRpNpc(projectRoot: string, input: {
    id: string;
    name: string;
    aliases?: string[];
    origin: RpNpcOrigin;
    narrativeRole: string;
    playerSummary: string;
    personaSummary?: string;
    household: string;
    tick: number;
    locationId?: string | null;
}): Promise<RpNpcRecord> {
    return mutate(projectRoot, "register_named", (state, now) => {
        const id = safeCharacterId(input.id);
        const name = requireText(input.name, "NPC 名称");
        const aliases = normalizeTexts(input.aliases ?? []);
        const duplicate = state.npcs.find((npc) => npc.id !== id && [npc.name, ...npc.aliases].some((known) => normalizeName(known) === normalizeName(name) || aliases.some((alias) => normalizeName(alias) === normalizeName(known))));
        if (duplicate) throw new Error(`NPC「${name}」已登记为 id=${duplicate.id}，禁止建立重复档案。`);
        const existing = state.npcs.find((npc) => npc.id === id);
        if (existing) {
            existing.lastSeenTick = Math.max(existing.lastSeenTick, requireTick(input.tick));
            existing.currentLocationId = optionalText(input.locationId);
            existing.aliases = [...new Set([...existing.aliases, ...aliases])];
            existing.updatedAt = now;
            return {value: existing, detail: {npcId: id, duplicate: true, tick: input.tick}};
        }
        const npc: RpNpcRecord = {
            id,
            name,
            aliases,
            tier: "named",
            origin: input.origin,
            narrativeRole: requireText(input.narrativeRole, "叙事身份"),
            playerSummary: requireText(input.playerSummary, "玩家可见 NPC 摘要"),
            personaSummary: optionalText(input.personaSummary) ?? "",
            household: requireText(input.household, "家境/经济身份"),
            firstNamedTick: requireTick(input.tick),
            lastSeenTick: requireTick(input.tick),
            currentLocationId: optionalText(input.locationId),
            inactiveReason: null,
            resourceStatus: "none",
            actorSession: "lazy",
            createdAt: now,
            updatedAt: now,
        };
        state.npcs.push(npc);
        return {value: npc, detail: {npcId: id, tier: npc.tier, origin: npc.origin}};
    });
}

/** screenwriter 只提出非阻塞擢升建议，不能直接改变层级。 */
export async function suggestRpNpcPromotion(projectRoot: string, input: {
    npcId: string;
    targetTier: "resident" | "major";
    reason: string;
    evidence: string[];
}): Promise<RpNpcSuggestion> {
    return mutate(projectRoot, "suggest_promotion", (state, now) => {
        const npc = requireNpc(state, input.npcId);
        validatePromotionTarget(npc.tier, input.targetTier);
        const existing = state.suggestions.find((item) => item.npcId === npc.id && item.targetTier === input.targetTier && item.status === "open");
        if (existing) return {value: existing, detail: {suggestionId: existing.id, duplicate: true}};
        const suggestion: RpNpcSuggestion = {
            id: `npc-suggestion-${randomUUID()}`,
            npcId: npc.id,
            targetTier: input.targetTier,
            reason: requireText(input.reason, "擢升建议原因"),
            evidence: normalizeTexts(input.evidence),
            status: "open",
            createdAt: now,
            updatedAt: now,
        };
        if (suggestion.evidence.length === 0) throw new Error("擢升建议必须列出互动、事件或关系证据。");
        state.suggestions.push(suggestion);
        return {value: suggestion, detail: {suggestionId: suggestion.id, npcId: npc.id, targetTier: suggestion.targetTier}};
    });
}

/** 玩家拒绝一条建议；建议保留审计但不再显示。 */
export async function rejectRpNpcSuggestion(projectRoot: string, suggestionId: string, reason: string): Promise<RpNpcSuggestion> {
    return mutate(projectRoot, "reject_suggestion", (state, now) => {
        const suggestion = requireSuggestion(state, suggestionId);
        if (suggestion.status !== "open") throw new Error(`擢升建议已经处理：${suggestion.status}`);
        suggestion.status = "rejected";
        suggestion.updatedAt = now;
        return {value: suggestion, detail: {suggestionId, reason: requireText(reason, "拒绝原因")}};
    });
}

/**
 * 玩家确认后擢升。named 可直接升 major；升 major 时从历史 Tick/事件/互动摘要补建角色档案与记忆。
 * 文件写入先于 roster 提交，重试由 ensure/commitTickMemory 的幂等行为保证。
 */
export async function promoteRpNpc(projectRoot: string, input: {
    npcId: string;
    targetTier: "resident" | "major";
    playerApproved: boolean;
    reason: string;
    tick: number;
    soul?: string;
    memoryBackfill?: RpNpcMemoryBackfill[];
}): Promise<{npc: RpNpcRecord; warnings: string[]}> {
    if (!input.playerApproved) throw new Error("具名升常驻、常驻或具名升主要角色都必须获得玩家确认。");
    await assertAdventureRunning(projectRoot);
    const statePath = join(projectRoot, RP_NPC_STATE_PATH);
    return withLock(statePath, async () => {
        const state = await readRpNpcState(projectRoot);
        const npc = requireNpc(state, input.npcId);
        if (npc.tier === input.targetTier) {
            const activeMajorCount = state.npcs.filter((item) => item.tier === "major").length;
            const warnings = activeMajorCount > state.activeMajorLimit
                ? [`活跃主要角色已有 ${activeMajorCount} 名，超过软上限 ${state.activeMajorLimit}；不会阻止擢升，但应将长期离场角色转为 major_inactive。`]
                : [];
            return {npc, warnings};
        }
        validatePromotionTarget(npc.tier, input.targetTier);
        const fromTier = npc.tier;
        const tick = requireTick(input.tick);
        const history = input.memoryBackfill ?? [];
        if (input.targetTier === "major") {
            await ensureRpCharacter(projectRoot, npc.id, {
                name: npc.name,
                aliases: npc.aliases,
                soul: optionalText(input.soul) ?? (npc.personaSummary || undefined),
            });
            for (const item of history) {
                await commitTickMemory(projectRoot, npc.id, {
                    tick: requireTick(item.tick),
                    detail: requireText(item.detail, "补建记忆详情"),
                    summaryLine: requireText(item.summaryLine, "补建记忆摘要"),
                    time: item.time,
                    participants: item.participants,
                });
            }
        }
        const now = new Date().toISOString();
        npc.tier = input.targetTier;
        npc.inactiveReason = null;
        npc.resourceStatus = npc.resourceStatus === "ready" ? "ready" : "pending";
        npc.updatedAt = now;
        const promotion: RpNpcPromotion = {
            id: `npc-promotion-${randomUUID()}`,
            npcId: npc.id,
            fromTier,
            toTier: npc.tier,
            reason: requireText(input.reason, "擢升原因"),
            playerApproved: true,
            tick,
            historySources: normalizeTexts(history.map((item) => item.sourceRef)),
            createdAt: now,
        };
        state.promotions.push(promotion);
        for (const suggestion of state.suggestions.filter((item) => item.npcId === npc.id && item.status === "open")) {
            suggestion.status = "accepted";
            suggestion.updatedAt = now;
        }
        state.updatedAt = now;
        await writeAtomic(statePath, state);
        const activeMajorCount = state.npcs.filter((item) => item.tier === "major").length;
        const warnings = activeMajorCount > state.activeMajorLimit
            ? [`活跃主要角色已有 ${activeMajorCount} 名，超过软上限 ${state.activeMajorLimit}；不会阻止擢升，但应将长期离场角色转为 major_inactive。`]
            : [];
        await appendLedger(projectRoot, {operation: "promote", at: now, promotionId: promotion.id, npcId: npc.id, fromTier, toTier: npc.tier, warnings});
        return {npc, warnings};
    });
}

/** world 更新出场位置；长期离场的 major 自动转为 major_inactive，档案不删除。 */
export async function setRpNpcPresence(projectRoot: string, input: {
    npcId: string;
    tick: number;
    locationId?: string | null;
    active: boolean;
    reason: string;
}): Promise<RpNpcRecord> {
    return mutate(projectRoot, "set_presence", (state, now) => {
        const npc = requireNpc(state, input.npcId);
        npc.lastSeenTick = Math.max(npc.lastSeenTick, requireTick(input.tick));
        npc.currentLocationId = optionalText(input.locationId);
        if (!input.active && npc.tier === "major") {
            npc.tier = "major_inactive";
            npc.inactiveReason = requireText(input.reason, "离场原因");
        } else if (input.active && npc.tier === "major_inactive") {
            npc.tier = "major";
            npc.inactiveReason = null;
        }
        npc.updatedAt = now;
        return {value: npc, detail: {npcId: npc.id, tier: npc.tier, active: input.active, reason: requireText(input.reason, "出场状态原因")}};
    });
}

/** resident/major 的精确资源账户由 mechanics 建立后，world 显式回写完成标记。 */
export async function markRpNpcResourcesReady(projectRoot: string, npcId: string): Promise<RpNpcRecord> {
    return mutate(projectRoot, "resources_ready", (state) => {
        const npc = requireNpc(state, npcId);
        if (!["resident", "major", "major_inactive"].includes(npc.tier)) throw new Error("只有常驻或主要角色维护精确资源账户。");
        npc.resourceStatus = "ready";
        return {value: npc, detail: {npcId: npc.id, resourceStatus: npc.resourceStatus}};
    });
}

type PlayerNpcRecord = Pick<RpNpcRecord, "id" | "name" | "tier" | "narrativeRole" | "playerSummary" | "lastSeenTick" | "currentLocationId">;

function validatePromotionTarget(fromTier: RpNpcTier, targetTier: "resident" | "major"): void {
    if (fromTier === "major" || fromTier === "major_inactive") throw new Error(`NPC 已是主要角色：${fromTier}`);
    if (fromTier === "resident" && targetTier === "resident") throw new Error("NPC 已是常驻角色。");
}

function requireNpc(state: RpNpcState, npcId: string): RpNpcRecord {
    const npc = state.npcs.find((item) => item.id === npcId);
    if (!npc) throw new Error(`未找到 NPC：${npcId}`);
    return npc;
}

function requireSuggestion(state: RpNpcState, suggestionId: string): RpNpcSuggestion {
    const suggestion = state.suggestions.find((item) => item.id === suggestionId);
    if (!suggestion) throw new Error(`未找到擢升建议：${suggestionId}`);
    return suggestion;
}

function requireText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label}不能为空。`);
    return normalized;
}

function optionalText(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized || null;
}

function normalizeTexts(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeName(value: string): string {
    return value.trim().toLowerCase();
}

function requireTick(tick: number): number {
    if (!Number.isInteger(tick) || tick < 0) throw new Error("tick 必须是非负整数。");
    return tick;
}

function emptyState(): RpNpcState {
    return {schemaVersion: 1, activeMajorLimit: DEFAULT_ACTIVE_MAJOR_LIMIT, npcs: [], promotions: [], suggestions: [], updatedAt: new Date(0).toISOString()};
}

async function mutate<T>(projectRoot: string, operation: string, action: (state: RpNpcState, now: string) => {value: T; detail: object}): Promise<T> {
    await assertAdventureRunning(projectRoot);
    const statePath = join(projectRoot, RP_NPC_STATE_PATH);
    return withLock(statePath, async () => {
        const state = await readRpNpcState(projectRoot);
        const now = new Date().toISOString();
        const result = action(state, now);
        state.updatedAt = now;
        await writeAtomic(statePath, state);
        await appendLedger(projectRoot, {operation, at: now, ...result.detail});
        return result.value;
    });
}

async function assertAdventureRunning(projectRoot: string): Promise<void> {
    await assertRpBootstrapStage(projectRoot, ["characters"]);
}

async function writeAtomic(path: string, state: RpNpcState): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    await rename(temporary, path);
}

async function appendLedger(projectRoot: string, value: object): Promise<void> {
    const path = join(projectRoot, RP_NPC_LEDGER_PATH);
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
