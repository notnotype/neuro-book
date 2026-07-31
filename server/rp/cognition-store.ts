import {randomUUID} from "node:crypto";
import {appendFile, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {z} from "zod";
import {readRpIntake} from "nbook/server/rp/intake-store";

export const RP_COGNITION_STATE_PATH = ".nbook/rp/runtime/cognition/state.json";
export const RP_COGNITION_LEDGER_PATH = ".nbook/rp/runtime/cognition-ledger.jsonl";

export type RpFactStatus = "established" | "disputed" | "superseded";
export type RpFactImportance = "normal" | "important" | "secret";
export type RpPlayerVisibility = "public" | "hidden" | "user_revealed";
export type RpBelief = "believes" | "disbelieves" | "uncertain";

export type RpWorldFact = {
    id: string;
    statement: string;
    status: RpFactStatus;
    importance: RpFactImportance;
    tags: string[];
    createdTick: number;
    updatedTick: number;
    source: string;
    createdAt: string;
    updatedAt: string;
};

export type RpCharacterBelief = {
    id: string;
    characterId: string;
    factId: string;
    belief: RpBelief;
    content: string;
    source: string;
    learnedTick: number;
    updatedTick: number;
    /** rumor 表示惰性传播所得，不保证与世界事实一致。 */
    channel: "observed" | "told" | "inferred" | "rumor";
    createdAt: string;
    updatedAt: string;
};

export type RpOocKnowledge = {
    factId: string;
    visibility: RpPlayerVisibility;
    reason: string;
    updatedAt: string;
};

export type RpCognitionState = {
    schemaVersion: 2;
    facts: RpWorldFact[];
    beliefs: RpCharacterBelief[];
    oocKnowledge: RpOocKnowledge[];
    /** 玩家跨时间线保留的事实副本；不会进入角色 belief 或当前分支客观事实。 */
    oocFacts: RpWorldFact[];
    settledTurnIds: string[];
    updatedAt: string;
};

export type RpCognitionSettlement =
    | {
        op: "learn";
        characterId: string;
        factId: string;
        belief: RpBelief;
        content: string;
        source: string;
        tick: number;
        channel: "observed" | "told" | "inferred";
    }
    | {
        op: "rumor";
        fromCharacterId: string;
        toCharacterId: string;
        factId: string;
        content: string;
        tick: number;
        relevanceReason: string;
    }
    | {
        op: "fact_status";
        factId: string;
        status: RpFactStatus;
        tick: number;
        reason: string;
    };

const FactSchema: z.ZodType<RpWorldFact> = z.object({
    id: z.string(), statement: z.string(), status: z.enum(["established", "disputed", "superseded"]), importance: z.enum(["normal", "important", "secret"]),
    tags: z.array(z.string()), createdTick: z.number().int().nonnegative(), updatedTick: z.number().int().nonnegative(), source: z.string(), createdAt: z.string(), updatedAt: z.string(),
});
const BeliefSchema: z.ZodType<RpCharacterBelief> = z.object({
    id: z.string(), characterId: z.string(), factId: z.string(), belief: z.enum(["believes", "disbelieves", "uncertain"]), content: z.string(), source: z.string(),
    learnedTick: z.number().int().nonnegative(), updatedTick: z.number().int().nonnegative(), channel: z.enum(["observed", "told", "inferred", "rumor"]), createdAt: z.string(), updatedAt: z.string(),
});
const OocSchema: z.ZodType<RpOocKnowledge> = z.object({factId: z.string(), visibility: z.enum(["public", "hidden", "user_revealed"]), reason: z.string(), updatedAt: z.string()});
const StateSchema: z.ZodType<RpCognitionState> = z.object({
    schemaVersion: z.literal(2), facts: z.array(FactSchema), beliefs: z.array(BeliefSchema), oocKnowledge: z.array(OocSchema), oocFacts: z.array(FactSchema), settledTurnIds: z.array(z.string()), updatedAt: z.string(),
});
const StoredStateSchema = z.union([
    StateSchema,
    z.object({schemaVersion: z.literal(1), facts: z.array(FactSchema), beliefs: z.array(BeliefSchema), oocKnowledge: z.array(OocSchema), settledTurnIds: z.array(z.string()), updatedAt: z.string()}),
]);

const locks = new Map<string, Promise<void>>();

/** 读取世界事实、角色信念、玩家 OOC 三层完整状态。 */
export async function readRpCognitionState(projectRoot: string): Promise<RpCognitionState> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(projectRoot, RP_COGNITION_STATE_PATH), "utf-8"));
        const state = StoredStateSchema.parse(parsed);
        if (state.schemaVersion === 2) return state;
        const visibleFactIds = new Set(state.oocKnowledge.filter((item) => item.visibility !== "hidden").map((item) => item.factId));
        return {...state, schemaVersion: 2, oocFacts: state.facts.filter((fact) => visibleFactIds.has(fact.id)).map((fact) => ({...fact, tags: [...fact.tags]}))};
    } catch (error) {
        if (!isNotFound(error)) throw error;
        return emptyState();
    }
}

/** 登记客观事实索引。important/secret 默认对玩家 OOC 隐藏。 */
export async function registerRpWorldFact(projectRoot: string, input: {
    id: string;
    statement: string;
    status?: RpFactStatus;
    importance: RpFactImportance;
    tags?: string[];
    tick: number;
    source: string;
}): Promise<RpWorldFact> {
    return mutate(projectRoot, "register_fact", (state, now) => {
        const id = safeId(input.id);
        const existing = state.facts.find((fact) => fact.id === id);
        const fact: RpWorldFact = {
            id,
            statement: requireText(input.statement, "事实陈述"),
            status: input.status ?? "established",
            importance: input.importance,
            tags: normalizeTags(input.tags ?? []),
            createdTick: existing?.createdTick ?? requireTick(input.tick),
            updatedTick: requireTick(input.tick),
            source: requireText(input.source, "事实来源"),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        if (existing) state.facts[state.facts.indexOf(existing)] = fact;
        else state.facts.push(fact);
        const visibility: RpPlayerVisibility = fact.importance === "normal" ? "public" : "hidden";
        const ooc = state.oocKnowledge.find((item) => item.factId === fact.id);
        if (!ooc) state.oocKnowledge.push({factId: fact.id, visibility, reason: fact.importance === "normal" ? "普通事实默认公开" : "重要条目默认隐藏", updatedAt: now});
        if ((ooc?.visibility ?? visibility) !== "hidden") upsertOocFact(state, fact);
        return {value: fact, detail: {factId: fact.id, importance: fact.importance}};
    });
}

/** 读取单个角色的主观认知；不自动附加世界真相。 */
export async function readRpCharacterCognition(projectRoot: string, characterId: string): Promise<RpCharacterBelief[]> {
    const state = await readRpCognitionState(projectRoot);
    return state.beliefs.filter((belief) => belief.characterId === characterId);
}

/** 玩家可见事实投影。user_revealed 只改变 OOC 层，不会让化身自动知道。 */
export async function readRpPlayerKnowledge(projectRoot: string): Promise<Array<{fact: RpWorldFact; visibility: Exclude<RpPlayerVisibility, "hidden">}>> {
    const state = await readRpCognitionState(projectRoot);
    return state.oocKnowledge.flatMap((ooc) => {
        if (ooc.visibility === "hidden") return [];
        const fact = state.facts.find((item) => item.id === ooc.factId) ?? state.oocFacts.find((item) => item.id === ooc.factId);
        return fact ? [{fact, visibility: ooc.visibility}] : [];
    });
}

/** 玩家主动解除隐藏或重新隐藏；绝不修改任何角色 belief。 */
export async function setRpOocVisibility(projectRoot: string, factId: string, visible: boolean, reason: string): Promise<RpOocKnowledge> {
    return mutate(projectRoot, "set_ooc_visibility", (state, now) => {
        requireFact(state, factId);
        let ooc = state.oocKnowledge.find((item) => item.factId === factId);
        const next: RpOocKnowledge = {
            factId,
            visibility: visible ? "user_revealed" : "hidden",
            reason: requireText(reason, "OOC 可见性变化原因"),
            updatedAt: now,
        };
        if (ooc) state.oocKnowledge[state.oocKnowledge.indexOf(ooc)] = next;
        else state.oocKnowledge.push(next);
        if (visible) upsertOocFact(state, requireFact(state, factId));
        ooc = next;
        return {value: ooc, detail: {factId, visibility: ooc.visibility}};
    });
}

/** 时间线恢复后合并玩家 OOC 认知；当前分支事实与角色 belief 保持恢复点状态。 */
export async function mergeRpOocKnowledge(projectRoot: string, source: Pick<RpCognitionState, "oocKnowledge" | "oocFacts">): Promise<RpCognitionState> {
    return mutate(projectRoot, "merge_ooc_after_restore", (state) => {
        for (const knowledge of source.oocKnowledge) {
            const existing = state.oocKnowledge.find((item) => item.factId === knowledge.factId);
            if (existing) state.oocKnowledge[state.oocKnowledge.indexOf(existing)] = knowledge;
            else state.oocKnowledge.push(knowledge);
        }
        for (const fact of source.oocFacts) upsertOocFact(state, fact);
        return {value: state, detail: {knowledgeCount: source.oocKnowledge.length, factCount: source.oocFacts.length}};
    });
}

/** committed 回合批量写入角色认知或事实状态，turnId 幂等。 */
export async function settleRpCognitionTurn(projectRoot: string, turnId: string, changes: RpCognitionSettlement[]): Promise<RpCognitionState> {
    await validateRpCognitionSettlements(projectRoot, changes);
    return mutate(projectRoot, "settle_turn", (state, now) => {
        if (state.settledTurnIds.includes(turnId)) return {value: state, detail: {turnId, duplicate: true}};
        for (const change of changes) validateChange(state, change);
        for (const change of changes) {
            if (change.op === "fact_status") {
                const fact = requireFact(state, change.factId);
                fact.status = change.status;
                fact.updatedTick = change.tick;
                fact.source = requireText(change.reason, "事实状态变化原因");
                fact.updatedAt = now;
                if (state.oocKnowledge.find((item) => item.factId === fact.id)?.visibility !== "hidden") upsertOocFact(state, fact);
                continue;
            }
            if (change.op === "rumor") {
                upsertBelief(state, now, {
                    characterId: change.toCharacterId,
                    factId: change.factId,
                    belief: "uncertain",
                    content: change.content,
                    source: `${change.fromCharacterId} 的传闻：${requireText(change.relevanceReason, "传闻相关性原因")}`,
                    tick: change.tick,
                    channel: "rumor",
                });
                continue;
            }
            upsertBelief(state, now, change);
        }
        state.settledTurnIds.push(turnId);
        return {value: state, detail: {turnId, changeCount: changes.length}};
    });
}

/** 在跨领域写入前预检全部事实引用与传播条件。 */
export async function validateRpCognitionSettlements(projectRoot: string, changes: RpCognitionSettlement[]): Promise<void> {
    const state = await readRpCognitionState(projectRoot);
    for (const change of changes) validateChange(state, change);
}

function upsertBelief(state: RpCognitionState, now: string, input: {
    characterId: string;
    factId: string;
    belief: RpBelief;
    content: string;
    source: string;
    tick: number;
    channel: "observed" | "told" | "inferred" | "rumor";
}): void {
    const characterId = safeId(input.characterId);
    const factId = safeId(input.factId);
    const existing = state.beliefs.find((item) => item.characterId === characterId && item.factId === factId);
    const belief: RpCharacterBelief = {
        id: existing?.id ?? `belief-${randomUUID()}`,
        characterId,
        factId,
        belief: input.belief,
        content: requireText(input.content, "角色认知内容"),
        source: requireText(input.source, "角色认知来源"),
        learnedTick: existing?.learnedTick ?? requireTick(input.tick),
        updatedTick: requireTick(input.tick),
        channel: input.channel,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    if (existing) state.beliefs[state.beliefs.indexOf(existing)] = belief;
    else state.beliefs.push(belief);
}

function validateChange(state: RpCognitionState, change: RpCognitionSettlement): void {
    requireFact(state, change.factId);
    requireTick(change.tick);
    if (change.op === "rumor") {
        if (change.fromCharacterId.trim() === change.toCharacterId.trim()) throw new Error("传闻不能从角色传播给自己。");
        requireText(change.relevanceReason, "传闻相关性原因");
    }
}

function requireFact(state: RpCognitionState, factId: string): RpWorldFact {
    const fact = state.facts.find((item) => item.id === factId);
    if (!fact) throw new Error(`未找到世界事实：${factId}`);
    return fact;
}

/** 按 factId 更新玩家 OOC 事实副本。 */
function upsertOocFact(state: RpCognitionState, fact: RpWorldFact): void {
    const copy = {...fact, tags: [...fact.tags]};
    const existing = state.oocFacts.find((item) => item.id === fact.id);
    if (existing) state.oocFacts[state.oocFacts.indexOf(existing)] = copy;
    else state.oocFacts.push(copy);
}

function normalizeTags(tags: string[]): string[] {
    return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function requireTick(tick: number): number {
    if (!Number.isInteger(tick) || tick < 0) throw new Error("tick 必须是非负整数。");
    return tick;
}

function safeId(value: string): string {
    const normalized = value.trim();
    if (!/^[\p{L}\p{N}_.:-]+$/u.test(normalized)) throw new Error(`非法认知 id：${value}`);
    return normalized;
}

function requireText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label}不能为空。`);
    return normalized;
}

function emptyState(): RpCognitionState {
    return {schemaVersion: 2, facts: [], beliefs: [], oocKnowledge: [], oocFacts: [], settledTurnIds: [], updatedAt: new Date(0).toISOString()};
}

async function mutate<T>(projectRoot: string, operation: string, action: (state: RpCognitionState, now: string) => {value: T; detail: object}): Promise<T> {
    await assertAdventureRunning(projectRoot);
    const path = join(projectRoot, RP_COGNITION_STATE_PATH);
    return withLock(path, async () => {
        const state = await readRpCognitionState(projectRoot);
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
    if (intake.phase !== "bootstrapping" && intake.phase !== "active") throw new Error(`RP 认知系统尚不可写：当前冒险阶段为 ${intake.phase}。`);
}

async function writeAtomic(path: string, state: RpCognitionState): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    await rename(temporary, path);
}

async function appendLedger(projectRoot: string, value: object): Promise<void> {
    const path = join(projectRoot, RP_COGNITION_LEDGER_PATH);
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
