import {createHash, randomUUID} from "node:crypto";
import {appendFile, mkdir, readFile, readdir, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {z} from "zod";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {recordRpEventTick} from "nbook/server/rp/event-store";
import {readRpIntake} from "nbook/server/rp/intake-store";
import {settleRpTurnRules, type RpTurnRulesSettlement} from "nbook/server/rp/turn-rules-store";

export const RP_TURN_ROOT = ".nbook/rp/runtime";
export const RP_TURN_LEDGER_PATH = `${RP_TURN_ROOT}/turn-ledger.jsonl`;
export const RP_UPDATE_LEDGER_PATH = `${RP_TURN_ROOT}/updates.jsonl`;
export const RP_ERROR_LEDGER_PATH = `${RP_TURN_ROOT}/errors.jsonl`;

export type RpTurnStatus = "draft" | "running" | "awaiting_player" | "committing" | "committed" | "failed" | "cancelled";

export type RpTurnRecord = {
    schemaVersion: 1;
    id: string;
    sequence: number;
    status: RpTurnStatus;
    /** 同一 Agent invocation 重试时复用，防止创建两个逻辑回合。 */
    requestKey: string;
    sessionId: number;
    /** 无 invocation runtime 的测试/手工入口为 null。 */
    invocationId: string | null;
    inputSummary: string;
    worldOperationId: string;
    /** committed 回合对应的正式正文路径；提交前为 null。 */
    prosePath: string | null;
    /** committed 后保存完整结算；其他状态为 null。 */
    settlement: JsonValue | null;
    /** waiting/failed/cancelled 时记录玩家可见原因。 */
    note: string | null;
    error: {
        stage: string;
        agent: string;
        message: string;
        at: string;
    } | null;
    createdAt: string;
    updatedAt: string;
    committedAt: string | null;
};

type StartTurnInput = {
    requestKey: string;
    sessionId: number;
    invocationId?: string;
    inputSummary: string;
};

const locks = new Map<string, Promise<void>>();

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));

const TurnSchema: z.ZodType<RpTurnRecord> = z.object({
    schemaVersion: z.literal(1),
    id: z.string(),
    sequence: z.number().int().positive(),
    status: z.enum(["draft", "running", "awaiting_player", "committing", "committed", "failed", "cancelled"]),
    requestKey: z.string(),
    sessionId: z.number().int().nonnegative(),
    invocationId: z.string().nullable(),
    inputSummary: z.string(),
    worldOperationId: z.string(),
    prosePath: z.string().nullable(),
    settlement: JsonValueSchema.nullable(),
    note: z.string().nullable(),
    error: z.object({stage: z.string(), agent: z.string(), message: z.string(), at: z.string()}).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    committedAt: z.string().nullable(),
});

/** 创建或按 requestKey 复用一个运行中回合。 */
export async function startRpTurn(projectRoot: string, input: StartTurnInput): Promise<RpTurnRecord> {
    const intake = await readRpIntake(projectRoot);
    if (intake.phase !== "active") throw new Error(`不能开始常规 RP 回合：当前冒险阶段为 ${intake.phase}。`);
    if (!input.requestKey.trim()) throw new Error("RP turn requestKey 不能为空。");
    if (!input.inputSummary.trim()) throw new Error("RP turn inputSummary 不能为空。");

    return withLock(join(projectRoot, RP_TURN_ROOT, "counter.json"), async () => {
        const requestPath = requestFile(projectRoot, input.requestKey);
        const existingId = await readTextFile(requestPath);
        if (existingId) {
            const existing = await readRpTurn(projectRoot, existingId.trim());
            const {ensureRpPipeline} = await import("nbook/server/rp/pipeline-store");
            await ensureRpPipeline(projectRoot, existing.id);
            return existing;
        }

        const sequence = await nextSequence(projectRoot);
        const id = `turn-${String(sequence).padStart(6, "0")}-${randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();
        const draft: RpTurnRecord = {
            schemaVersion: 1,
            id,
            sequence,
            status: "draft",
            requestKey: input.requestKey,
            sessionId: input.sessionId,
            invocationId: input.invocationId ?? null,
            inputSummary: input.inputSummary,
            worldOperationId: `rp-turn:${id}:world-commit`,
            prosePath: null,
            settlement: null,
            note: null,
            error: null,
            createdAt: now,
            updatedAt: now,
            committedAt: null,
        };
        await writeTurn(projectRoot, draft);
        await appendTransition(projectRoot, draft);
        const running = {...draft, status: "running" as const};
        await writeTurn(projectRoot, running);
        await appendTransition(projectRoot, running);
        await writeTextAtomic(requestPath, `${id}\n`);
        const {ensureRpPipeline} = await import("nbook/server/rp/pipeline-store");
        await ensureRpPipeline(projectRoot, running.id);
        return running;
    });
}

/** 读取单个回合的 canonical 状态文件。 */
export async function readRpTurn(projectRoot: string, turnId: string): Promise<RpTurnRecord> {
    const source = await readFile(turnPath(projectRoot, turnId), "utf-8");
    const parsed: unknown = JSON.parse(source);
    return TurnSchema.parse(parsed);
}

/** 为恢复后的新 invocation 绑定既有 turn，供子 Agent 门禁识别当前回合。 */
export async function linkRpTurnRequest(projectRoot: string, requestKey: string, turnId: string, sessionId: number): Promise<void> {
    const turn = await readRpTurn(projectRoot, turnId);
    if (turn.sessionId !== sessionId) throw new Error(`回合 ${turnId} 不属于当前 rp.leader session。`);
    await writeTextAtomic(requestFile(projectRoot, requestKey), `${turnId}\n`);
}

/** 按 Agent invocation requestKey 读取当前逻辑回合；不存在返回 null。 */
export async function findRpTurnByRequest(projectRoot: string, requestKey: string): Promise<RpTurnRecord | null> {
    const turnId = await readTextFile(requestFile(projectRoot, requestKey));
    return turnId ? readRpTurn(projectRoot, turnId.trim()) : null;
}

/** 列出尚未形成正式历史的回合，供项目重开后的恢复窗口使用。 */
export async function listIncompleteRpTurns(projectRoot: string): Promise<RpTurnRecord[]> {
    const records = await listRpTurns(projectRoot);
    return records.filter((record) => !["committed", "failed", "cancelled"].includes(record.status)).sort((a, b) => a.sequence - b.sequence);
}

/** 列出全部回合 canonical 记录；UI 与恢复工具统一复用，默认按新到旧排序。 */
export async function listRpTurns(projectRoot: string): Promise<RpTurnRecord[]> {
    const root = join(projectRoot, RP_TURN_ROOT, "turns");
    let names: string[];
    try {
        names = await readdir(root);
    } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
    }
    const records = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readRpTurn(projectRoot, name.slice(0, -5))));
    return records.sort((a, b) => b.sequence - a.sequence);
}

/** 正文面板只展示 committed 回合登记的路径；开场 Tick 000000 由 prose-store 单独允许。 */
export async function listCommittedProsePaths(projectRoot: string): Promise<Set<string>> {
    const root = join(projectRoot, RP_TURN_ROOT, "turns");
    let names: string[];
    try {
        names = await readdir(root);
    } catch (error) {
        if (isNotFound(error)) return new Set();
        throw error;
    }
    const records = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readRpTurn(projectRoot, name.slice(0, -5))));
    return new Set(records.filter((record) => record.status === "committed" && record.prosePath).map((record) => record.prosePath!));
}

/** 是否已经启用 P2 回合账本；无账本的旧数据面 fixture 继续按目录读取。 */
export async function hasRpTurnLedger(projectRoot: string): Promise<boolean> {
    const root = join(projectRoot, RP_TURN_ROOT, "turns");
    try {
        return (await readdir(root)).some((name) => name.endsWith(".json"));
    } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
    }
}

/** 判定需要玩家掷骰、确认或选择时暂停。 */
export async function awaitRpTurnPlayer(projectRoot: string, turnId: string, note: string): Promise<RpTurnRecord> {
    return transition(projectRoot, turnId, ["running"], "awaiting_player", {note});
}

/** 玩家提交有效回执后恢复同一回合。 */
export async function resumeRpTurn(projectRoot: string, turnId: string): Promise<RpTurnRecord> {
    return transition(projectRoot, turnId, ["awaiting_player"], "running", {note: null});
}

/** 进入 world 原子提交阶段，并返回必须传给 execute_world 的幂等 operationId。 */
export async function beginRpTurnCommit(projectRoot: string, turnId: string): Promise<RpTurnRecord> {
    const current = await readRpTurn(projectRoot, turnId);
    if (current.status === "committing" || current.status === "committed") return current;
    const {assertRpPipelineReadyForCommit} = await import("nbook/server/rp/pipeline-store");
    await assertRpPipelineReadyForCommit(projectRoot, turnId);
    const {assertRpTimelineCommitCapacity} = await import("nbook/server/rp/timeline-store");
    await assertRpTimelineCommitCapacity(projectRoot);
    const {runRpConsistencyCheck} = await import("nbook/server/rp/consistency-store");
    const consistency = await runRpConsistencyCheck(projectRoot, "light", true);
    if (consistency.status === "blocked") throw new Error(`提交前一致性检查未通过：${consistency.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join("；")}`);
    return transition(projectRoot, turnId, ["running"], "committing", {});
}

/** World Engine 同 operationId 已成功后提交回合账本；重复调用返回第一次结果。 */
export async function commitRpTurn(
    projectRoot: string,
    turnId: string,
    prosePath: string,
    settlement: JsonValue,
    meaningfulEvent = true,
    rules?: RpTurnRulesSettlement,
): Promise<RpTurnRecord> {
    if (!/^rp\/ticks\/\d{6}(?:-[\w-]+)?\/prose\.md$/u.test(prosePath)) {
        throw new Error(`非法 RP prosePath：${prosePath}`);
    }
    return withLock(turnPath(projectRoot, turnId), async () => {
        const current = await readRpTurn(projectRoot, turnId);
        if (current.status === "committed") {
            if (rules) await settleRpTurnRules(projectRoot, current.id, rules);
            await appendUpdate(projectRoot, current);
            await recordRpEventTick(projectRoot, current.id, meaningfulEvent);
            const {completeRpPipeline} = await import("nbook/server/rp/pipeline-store");
            await completeRpPipeline(projectRoot, current.id);
            const {captureCommittedRpTimeline} = await import("nbook/server/rp/timeline-store");
            await captureCommittedRpTimeline(projectRoot, current);
            return current;
        }
        if (current.status !== "committing") throw new Error(`回合 ${turnId} 当前为 ${current.status}，不能提交。`);
        // P4 规则先做全量预检并以 turnId 幂等写入；任一步失败时回合保持 committing，可修正后重试。
        if (rules) await settleRpTurnRules(projectRoot, current.id, rules);
        const now = new Date().toISOString();
        const committed: RpTurnRecord = {
            ...current,
            status: "committed",
            prosePath,
            settlement,
            note: null,
            error: null,
            updatedAt: now,
            committedAt: now,
        };
        await writeTurn(projectRoot, committed);
        await appendTransition(projectRoot, committed);
        await appendUpdate(projectRoot, committed);
        const {completeRpPipeline} = await import("nbook/server/rp/pipeline-store");
        await completeRpPipeline(projectRoot, committed.id);
        // 事件触发器只在正式提交后计数；若此步响应中断，同 turnId 重试不会重复增长。
        await recordRpEventTick(projectRoot, committed.id, meaningfulEvent);
        const {captureCommittedRpTimeline} = await import("nbook/server/rp/timeline-store");
        await captureCommittedRpTimeline(projectRoot, committed);
        return committed;
    });
}

/** 记录失败阶段、Agent 和真实问题；不产生世界结算。 */
export async function failRpTurn(projectRoot: string, turnId: string, error: {stage: string; agent: string; message: string}): Promise<RpTurnRecord> {
    const current = await readRpTurn(projectRoot, turnId);
    if (current.status === "failed") return current;
    if (["committed", "cancelled"].includes(current.status)) throw new Error(`回合 ${turnId} 已为 ${current.status}，不能标记失败。`);
    const at = new Date().toISOString();
    // committing 错误可能发生在“数据库已提交、响应未送达”之后，必须保留 committing 以便同 operationId 恢复。
    const targetStatus = current.status === "committing" ? "committing" : "failed";
    const failed = await transition(projectRoot, turnId, ["draft", "running", "awaiting_player", "committing", "failed"], targetStatus, {
        note: error.message,
        error: {...error, at},
    });
    await appendJsonLine(join(projectRoot, RP_ERROR_LEDGER_PATH), {turnId, at, ...error});
    return failed;
}

/** 取消尚未进入提交阶段的回合。committing 必须先检查 World operation 再恢复。 */
export async function cancelRpTurn(projectRoot: string, turnId: string, note: string): Promise<RpTurnRecord> {
    return transition(projectRoot, turnId, ["draft", "running", "awaiting_player", "cancelled"], "cancelled", {note});
}

async function transition(
    projectRoot: string,
    turnId: string,
    allowed: RpTurnStatus[],
    status: RpTurnStatus,
    patch: Partial<Pick<RpTurnRecord, "note" | "error">>,
): Promise<RpTurnRecord> {
    return withLock(turnPath(projectRoot, turnId), async () => {
        const current = await readRpTurn(projectRoot, turnId);
        if (current.status === status && Object.keys(patch).length === 0) return current;
        if (!allowed.includes(current.status)) throw new Error(`回合 ${turnId} 当前为 ${current.status}，不能进入 ${status}。`);
        const next: RpTurnRecord = {...current, ...patch, status, updatedAt: new Date().toISOString()};
        await writeTurn(projectRoot, next);
        await appendTransition(projectRoot, next);
        return next;
    });
}

async function nextSequence(projectRoot: string): Promise<number> {
    const path = join(projectRoot, RP_TURN_ROOT, "counter.json");
    let current = 0;
    try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf-8"));
        current = z.object({last: z.number().int().nonnegative()}).parse(parsed).last;
    } catch (error) {
        if (!isNotFound(error)) throw error;
    }
    const next = current + 1;
    await writeJsonAtomic(path, {last: next});
    return next;
}

async function writeTurn(projectRoot: string, turn: RpTurnRecord): Promise<void> {
    await writeJsonAtomic(turnPath(projectRoot, turn.id), turn);
}

async function appendTransition(projectRoot: string, turn: RpTurnRecord): Promise<void> {
    await appendJsonLine(join(projectRoot, RP_TURN_LEDGER_PATH), {
        turnId: turn.id,
        sequence: turn.sequence,
        status: turn.status,
        at: turn.updatedAt,
        note: turn.note,
    });
}

async function appendUpdate(projectRoot: string, turn: RpTurnRecord): Promise<void> {
    await appendUniqueTurnLine(join(projectRoot, RP_UPDATE_LEDGER_PATH), turn.id, {
        turnId: turn.id,
        sequence: turn.sequence,
        at: turn.committedAt ?? turn.updatedAt,
        inputSummary: turn.inputSummary,
        settlement: turn.settlement,
        prosePath: turn.prosePath,
    });
}

/** 以 turnId 去重的 JSONL 投影；canonical 状态仍是 turns/{id}.json。 */
async function appendUniqueTurnLine(path: string, turnId: string, value: JsonValue): Promise<void> {
    await withLock(path, async () => {
        const source = await readTextFile(path);
        if (source?.split(/\r?\n/u).some((line) => line.includes(`\"turnId\":\"${turnId}\"`))) return;
        await mkdir(dirname(path), {recursive: true});
        await appendFile(path, `${JSON.stringify(value)}\n`, "utf-8");
    });
}

async function appendJsonLine(path: string, value: JsonValue): Promise<void> {
    await withLock(path, async () => {
        await mkdir(dirname(path), {recursive: true});
        await appendFile(path, `${JSON.stringify(value)}\n`, "utf-8");
    });
}

async function writeJsonAtomic(path: string, value: JsonValue): Promise<void> {
    await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomic(path: string, value: string): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, value, "utf-8");
    await rename(temporary, path);
}

async function readTextFile(path: string): Promise<string | null> {
    try {
        return await readFile(path, "utf-8");
    } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
    }
}

function turnPath(projectRoot: string, turnId: string): string {
    if (!/^turn-\d{6}-[a-f0-9]{8}$/u.test(turnId)) throw new Error(`非法 RP turn id：${turnId}`);
    return join(projectRoot, RP_TURN_ROOT, "turns", `${turnId}.json`);
}

function requestFile(projectRoot: string, requestKey: string): string {
    const digest = createHash("sha256").update(requestKey).digest("hex");
    return join(projectRoot, RP_TURN_ROOT, "requests", `${digest}.txt`);
}

async function withLock<T>(path: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(path) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
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
