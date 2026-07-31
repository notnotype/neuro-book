import {randomUUID} from "node:crypto";
import {appendFile, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {z} from "zod";
import {readRpIntake} from "nbook/server/rp/intake-store";

export const RP_RELATION_STATE_PATH = ".nbook/rp/runtime/relations/state.json";
export const RP_RELATION_LEDGER_PATH = ".nbook/rp/runtime/relation-ledger.jsonl";

export const RP_RELATION_DIMENSIONS = ["familiarity", "trust", "affection", "attraction", "respect", "dependence", "fear", "hostility"] as const;
export type RpRelationDimension = typeof RP_RELATION_DIMENSIONS[number];

export type RpRelationDimensions = {
    familiarity: number;
    trust: number;
    affection: number;
    attraction: number;
    respect: number;
    dependence: number;
    fear: number;
    hostility: number;
};

export type RpRelationEdge = {
    id: string;
    sourceId: string;
    targetId: string;
    dimensions: RpRelationDimensions;
    /** 标签只来自设定或实际互动，不由数值阈值生成。 */
    tags: string[];
    createdAt: string;
    updatedAt: string;
};

export type RpRelationChange = {
    id: string;
    turnId: string;
    tick: number;
    sourceId: string;
    targetId: string;
    deltas: Partial<RpRelationDimensions>;
    addedTags: string[];
    removedTags: string[];
    basis: "interaction" | "setting" | "player_declaration";
    reason: string;
    at: string;
};

export type RpRelationState = {
    schemaVersion: 1;
    edges: RpRelationEdge[];
    changes: RpRelationChange[];
    settledTurnIds: string[];
    updatedAt: string;
};

export type RpRelationSettlement = {
    tick: number;
    sourceId: string;
    targetId: string;
    deltas: Partial<RpRelationDimensions>;
    addTags?: string[];
    removeTags?: string[];
    basis: "interaction" | "setting" | "player_declaration" | "dice";
    reason: string;
    /** 化身作为 source 时为 true；系统不得替化身决定情感、吸引和信任。 */
    sourceIsAvatar?: boolean;
    /** 只有玩家明确表达自身倾向时为 true。 */
    playerDeclared?: boolean;
};

const DimensionsSchema: z.ZodType<RpRelationDimensions> = z.object({
    familiarity: z.number().int().min(0).max(100), trust: z.number().int().min(0).max(100),
    affection: z.number().int().min(0).max(100), attraction: z.number().int().min(0).max(100),
    respect: z.number().int().min(0).max(100), dependence: z.number().int().min(0).max(100),
    fear: z.number().int().min(0).max(100), hostility: z.number().int().min(0).max(100),
});
const DeltaSchema = z.object({
    familiarity: z.number().int().optional(), trust: z.number().int().optional(), affection: z.number().int().optional(),
    attraction: z.number().int().optional(), respect: z.number().int().optional(), dependence: z.number().int().optional(),
    fear: z.number().int().optional(), hostility: z.number().int().optional(),
});
const EdgeSchema: z.ZodType<RpRelationEdge> = z.object({
    id: z.string(), sourceId: z.string(), targetId: z.string(), dimensions: DimensionsSchema, tags: z.array(z.string()), createdAt: z.string(), updatedAt: z.string(),
});
const ChangeSchema: z.ZodType<RpRelationChange> = z.object({
    id: z.string(), turnId: z.string(), tick: z.number().int().nonnegative(), sourceId: z.string(), targetId: z.string(), deltas: DeltaSchema,
    addedTags: z.array(z.string()), removedTags: z.array(z.string()), basis: z.enum(["interaction", "setting", "player_declaration"]), reason: z.string(), at: z.string(),
});
const StateSchema: z.ZodType<RpRelationState> = z.object({
    schemaVersion: z.literal(1), edges: z.array(EdgeSchema), changes: z.array(ChangeSchema), settledTurnIds: z.array(z.string()), updatedAt: z.string(),
});

const locks = new Map<string, Promise<void>>();

/** 读取完整有向关系状态；A→B 与 B→A 是两条独立边。 */
export async function readRpRelationState(projectRoot: string): Promise<RpRelationState> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(projectRoot, RP_RELATION_STATE_PATH), "utf-8"));
        return StateSchema.parse(parsed);
    } catch (error) {
        if (!isNotFound(error)) throw error;
        return emptyState();
    }
}

/** 按角色读取出向/入向关系，不做镜像合并。 */
export async function readRpCharacterRelations(projectRoot: string, characterId: string): Promise<{outgoing: RpRelationEdge[]; incoming: RpRelationEdge[]}> {
    const state = await readRpRelationState(projectRoot);
    return {
        outgoing: state.edges.filter((edge) => edge.sourceId === characterId),
        incoming: state.edges.filter((edge) => edge.targetId === characterId),
    };
}

/**
 * committed 回合的关系批量结算。整个 turnId 幂等；任一变化非法时不写状态。
 * 骰子不能直接建立关系，化身的信任/情感/吸引只能来自玩家明确表达。
 */
export async function settleRpRelationsTurn(projectRoot: string, turnId: string, changes: RpRelationSettlement[]): Promise<RpRelationState> {
    validateRpRelationSettlements(changes);
    return mutate(projectRoot, "settle_turn", (state, now) => {
        if (state.settledTurnIds.includes(turnId)) return {value: state, detail: {turnId, duplicate: true}};
        for (const change of changes) validateSettlement(change);
        for (const input of changes) {
            if (input.basis === "dice") throw new Error("骰子不能直接进入关系结算。");
            const sourceId = requireText(input.sourceId, "sourceId");
            const targetId = requireText(input.targetId, "targetId");
            const edgeId = relationId(sourceId, targetId);
            let edge = state.edges.find((item) => item.id === edgeId);
            if (!edge) {
                edge = {id: edgeId, sourceId, targetId, dimensions: emptyDimensions(), tags: [], createdAt: now, updatedAt: now};
                state.edges.push(edge);
            }
            const normalizedDeltas = normalizeDeltas(input.deltas);
            for (const dimension of RP_RELATION_DIMENSIONS) {
                edge.dimensions[dimension] = clampDimension(edge.dimensions[dimension] + (normalizedDeltas[dimension] ?? 0));
            }
            const addTags = normalizeTags(input.addTags ?? []);
            const removeTags = normalizeTags(input.removeTags ?? []);
            edge.tags = [...new Set([...edge.tags.filter((tag) => !removeTags.includes(tag)), ...addTags])];
            edge.updatedAt = now;
            state.changes.push({
                id: `relation-change-${randomUUID()}`,
                turnId,
                tick: input.tick,
                sourceId,
                targetId,
                deltas: normalizedDeltas,
                addedTags: addTags,
                removedTags: removeTags,
                basis: input.basis,
                reason: requireText(input.reason, "关系变化原因"),
                at: now,
            });
        }
        state.settledTurnIds.push(turnId);
        return {value: state, detail: {turnId, changeCount: changes.length}};
    });
}

/** 在跨领域写入前预检全部关系变化。 */
export function validateRpRelationSettlements(changes: RpRelationSettlement[]): void {
    for (const change of changes) validateSettlement(change);
}

function validateSettlement(input: RpRelationSettlement): void {
    if (!Number.isInteger(input.tick) || input.tick < 0) throw new Error("关系变化 tick 必须是非负整数。");
    if (input.sourceId.trim() === input.targetId.trim()) throw new Error("关系 sourceId 与 targetId 不能相同。");
    if (input.basis === "dice") throw new Error("骰子只能影响是否愿意交流，不能直接建立或改变关系。");
    const deltas = normalizeDeltas(input.deltas);
    if (input.sourceIsAvatar && !input.playerDeclared) {
        const protectedDimensions: RpRelationDimension[] = ["trust", "affection", "attraction"];
        const changedProtected = protectedDimensions.filter((dimension) => (deltas[dimension] ?? 0) !== 0);
        if (changedProtected.length > 0) throw new Error(`系统不能替玩家决定化身的 ${changedProtected.join("/")}；只有玩家明确表达后才能变化。`);
    }
    if ((input.addTags?.length ?? 0) > 0 || (input.removeTags?.length ?? 0) > 0) requireText(input.reason, "关系标签变化原因");
}

function normalizeDeltas(input: Partial<RpRelationDimensions>): Partial<RpRelationDimensions> {
    const result: Partial<RpRelationDimensions> = {};
    for (const dimension of RP_RELATION_DIMENSIONS) {
        const value = input[dimension];
        if (value === undefined || value === 0) continue;
        if (!Number.isInteger(value) || value < -100 || value > 100) throw new Error(`关系维度 ${dimension} 的单次变化必须是 -100 到 100 的整数。`);
        result[dimension] = value;
    }
    return result;
}

function normalizeTags(tags: string[]): string[] {
    return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function relationId(sourceId: string, targetId: string): string {
    return `${safeId(sourceId)}->${safeId(targetId)}`;
}

function emptyDimensions(): RpRelationDimensions {
    return {familiarity: 0, trust: 0, affection: 0, attraction: 0, respect: 0, dependence: 0, fear: 0, hostility: 0};
}

function clampDimension(value: number): number {
    return Math.min(100, Math.max(0, value));
}

function safeId(value: string): string {
    const normalized = value.trim();
    if (!/^[\p{L}\p{N}_.:-]+$/u.test(normalized)) throw new Error(`非法关系角色 id：${value}`);
    return normalized;
}

function requireText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label}不能为空。`);
    return normalized;
}

function emptyState(): RpRelationState {
    return {schemaVersion: 1, edges: [], changes: [], settledTurnIds: [], updatedAt: new Date(0).toISOString()};
}

async function mutate<T>(projectRoot: string, operation: string, action: (state: RpRelationState, now: string) => {value: T; detail: object}): Promise<T> {
    await assertAdventureRunning(projectRoot);
    const path = join(projectRoot, RP_RELATION_STATE_PATH);
    return withLock(path, async () => {
        const state = await readRpRelationState(projectRoot);
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
    if (intake.phase !== "bootstrapping" && intake.phase !== "active") throw new Error(`RP 关系系统尚不可写：当前冒险阶段为 ${intake.phase}。`);
}

async function writeAtomic(path: string, state: RpRelationState): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    await rename(temporary, path);
}

async function appendLedger(projectRoot: string, value: object): Promise<void> {
    const path = join(projectRoot, RP_RELATION_LEDGER_PATH);
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
