import {randomUUID} from "node:crypto";
import {appendFile, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {z} from "zod";
import {readRpEventState} from "nbook/server/rp/event-store";
import {readRpIntake} from "nbook/server/rp/intake-store";
import {rpRandomInt} from "nbook/server/rp/random-source";

export const RP_MECHANICS_STATE_PATH = ".nbook/rp/runtime/mechanics/state.json";
export const RP_MECHANICS_LEDGER_PATH = ".nbook/rp/runtime/mechanics-ledger.jsonl";

export type RpResourceKind = "ledger" | "time_derived" | "dynamic";
export type RpOwnerTier = "player" | "resident" | "major";

export type RpResourceBand = {
    min: number;
    max: number;
    label: string;
};

export type RpPeriodicRule = {
    id: string;
    everySeconds: string;
    delta: number;
    anchorInstant: string;
    label: string;
};

export type RpResourceDefinition = {
    id: string;
    label: string;
    kind: RpResourceKind;
    unit: string;
    min: number | null;
    max: number | null;
    bands: RpResourceBand[];
    periodicRules: RpPeriodicRule[];
    /** time_derived 专用：每 numeratorSeconds 秒变化 numeratorDelta。 */
    derivedRate: {
        numeratorDelta: number;
        numeratorSeconds: string;
    } | null;
    createdAt: string;
    updatedAt: string;
};

export type RpResourceAccount = {
    id: string;
    subjectId: string;
    ownerTier: RpOwnerTier;
    resourceId: string;
    /** ledger/dynamic 当前精确整数；time_derived 为锚点值。 */
    value: number;
    anchorInstant: string;
    lastSettledInstant: string;
    updatedAt: string;
};

export type RpCycleDefinition = {
    id: string;
    subjectId: string;
    label: string;
    anchorInstant: string;
    lengthSeconds: string;
    phases: Array<{
        label: string;
        startSecond: string;
        endSecond: string;
    }>;
    private: boolean;
    createdAt: string;
    updatedAt: string;
};

export type RpMechanicsTransaction = {
    id: string;
    turnId: string;
    accountId: string;
    kind: "direct" | "periodic";
    delta: number;
    balance: number;
    reason: string;
    atInstant: string;
    atTime: string;
};

export type RpTimeRecord = {
    turnId: string;
    startInstant: string;
    endInstant: string;
    startTime: string;
    endTime: string;
    longJump: boolean;
    summary: string;
    committedAt: string;
};

export type RpRiskResolution = {
    operationId: string;
    subjectId: string;
    kind: "pregnancy" | "custom";
    riskLevel: "none" | "low" | "medium" | "high" | "extreme";
    probabilityPpm: number;
    rollPpm: number;
    occurred: boolean;
    private: boolean;
    reason: string;
    resolvedAt: string;
};

export type RpJumpApproval = {
    id: string;
    turnId: string;
    startInstant: string;
    endInstant: string;
    eventIds: string[];
    approvedAt: string;
};

export type RpMechanicsState = {
    schemaVersion: 1;
    resources: RpResourceDefinition[];
    accounts: RpResourceAccount[];
    cycles: RpCycleDefinition[];
    transactions: RpMechanicsTransaction[];
    timeRecords: RpTimeRecord[];
    riskResolutions: RpRiskResolution[];
    jumpApprovals: RpJumpApproval[];
    settledTurnIds: string[];
    updatedAt: string;
};

export type RpMechanicsSettlement = {
    startInstant: string;
    endInstant: string;
    startTime: string;
    endTime: string;
    longJump: boolean;
    summary: string;
    resourceChanges: Array<{
        accountId: string;
        delta: number;
        reason: string;
    }>;
};

const ResourceBandSchema = z.object({min: z.number().int(), max: z.number().int(), label: z.string()});
const PeriodicRuleSchema = z.object({
    id: z.string(), everySeconds: z.string(), delta: z.number().int(), anchorInstant: z.string(), label: z.string(),
});
const ResourceSchema: z.ZodType<RpResourceDefinition> = z.object({
    id: z.string(), label: z.string(), kind: z.enum(["ledger", "time_derived", "dynamic"]), unit: z.string(),
    min: z.number().int().nullable(), max: z.number().int().nullable(), bands: z.array(ResourceBandSchema), periodicRules: z.array(PeriodicRuleSchema),
    derivedRate: z.object({numeratorDelta: z.number().int(), numeratorSeconds: z.string()}).nullable(),
    createdAt: z.string(), updatedAt: z.string(),
});
const AccountSchema: z.ZodType<RpResourceAccount> = z.object({
    id: z.string(), subjectId: z.string(), ownerTier: z.enum(["player", "resident", "major"]), resourceId: z.string(), value: z.number().int(),
    anchorInstant: z.string(), lastSettledInstant: z.string(), updatedAt: z.string(),
});
const CycleSchema: z.ZodType<RpCycleDefinition> = z.object({
    id: z.string(), subjectId: z.string(), label: z.string(), anchorInstant: z.string(), lengthSeconds: z.string(),
    phases: z.array(z.object({label: z.string(), startSecond: z.string(), endSecond: z.string()})),
    private: z.boolean(), createdAt: z.string(), updatedAt: z.string(),
});
const TransactionSchema: z.ZodType<RpMechanicsTransaction> = z.object({
    id: z.string(), turnId: z.string(), accountId: z.string(), kind: z.enum(["direct", "periodic"]), delta: z.number().int(), balance: z.number().int(),
    reason: z.string(), atInstant: z.string(), atTime: z.string(),
});
const TimeRecordSchema: z.ZodType<RpTimeRecord> = z.object({
    turnId: z.string(), startInstant: z.string(), endInstant: z.string(), startTime: z.string(), endTime: z.string(), longJump: z.boolean(), summary: z.string(), committedAt: z.string(),
});
const RiskSchema: z.ZodType<RpRiskResolution> = z.object({
    operationId: z.string(), subjectId: z.string(), kind: z.enum(["pregnancy", "custom"]),
    riskLevel: z.enum(["none", "low", "medium", "high", "extreme"]), probabilityPpm: z.number().int().min(0).max(1_000_000),
    rollPpm: z.number().int().min(0).max(999_999), occurred: z.boolean(), private: z.boolean(), reason: z.string(), resolvedAt: z.string(),
});
const JumpApprovalSchema: z.ZodType<RpJumpApproval> = z.object({
    id: z.string(), turnId: z.string(), startInstant: z.string(), endInstant: z.string(), eventIds: z.array(z.string()), approvedAt: z.string(),
});
const StateSchema: z.ZodType<RpMechanicsState> = z.object({
    schemaVersion: z.literal(1), resources: z.array(ResourceSchema), accounts: z.array(AccountSchema), cycles: z.array(CycleSchema),
    transactions: z.array(TransactionSchema), timeRecords: z.array(TimeRecordSchema), riskResolutions: z.array(RiskSchema), jumpApprovals: z.array(JumpApprovalSchema),
    settledTurnIds: z.array(z.string()), updatedAt: z.string(),
});

const locks = new Map<string, Promise<void>>();

/** 读取时间、资源和周期规则状态；World Engine Instant 仍是当前时间真相源。 */
export async function readRpMechanicsState(projectRoot: string): Promise<RpMechanicsState> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(projectRoot, RP_MECHANICS_STATE_PATH), "utf-8"));
        return StateSchema.parse(parsed);
    } catch (error) {
        if (!isNotFound(error)) throw error;
        return emptyState();
    }
}

/** 声明资源规则。玩家自定义资源也走同一声明式结构，不执行任意代码。 */
export async function defineRpResource(projectRoot: string, input: Omit<RpResourceDefinition, "createdAt" | "updatedAt">): Promise<RpResourceDefinition> {
    validateResource(input);
    return mutate(projectRoot, "define_resource", (state, now) => {
        const existing = state.resources.find((resource) => resource.id === input.id);
        const resource: RpResourceDefinition = {...input, createdAt: existing?.createdAt ?? now, updatedAt: now};
        if (existing) state.resources[state.resources.indexOf(existing)] = resource;
        else state.resources.push(resource);
        return {value: resource, detail: {resourceId: resource.id, kind: resource.kind}};
    });
}

/** 仅化身、常驻与主要角色维护精确账户。 */
export async function openRpResourceAccount(projectRoot: string, input: {
    subjectId: string;
    ownerTier: RpOwnerTier;
    resourceId: string;
    initialValue: number;
    anchorInstant: string;
}): Promise<RpResourceAccount> {
    return mutate(projectRoot, "open_account", (state, now) => {
        const resource = requireResource(state, input.resourceId);
        const id = `${safeId(input.subjectId)}:${resource.id}`;
        const existing = state.accounts.find((account) => account.id === id);
        if (existing) return {value: existing, detail: {accountId: id, reused: true}};
        const account: RpResourceAccount = {
            id,
            subjectId: requireText(input.subjectId, "subjectId"),
            ownerTier: input.ownerTier,
            resourceId: resource.id,
            value: clampInteger(input.initialValue, resource),
            anchorInstant: parseInstantString(input.anchorInstant).toString(),
            lastSettledInstant: parseInstantString(input.anchorInstant).toString(),
            updatedAt: now,
        };
        state.accounts.push(account);
        return {value: account, detail: {accountId: id, initialValue: account.value}};
    });
}

/** 登记任意周期模块；生理周期只是其中一种配置。 */
export async function defineRpCycle(projectRoot: string, input: Omit<RpCycleDefinition, "createdAt" | "updatedAt">): Promise<RpCycleDefinition> {
    validateCycle(input);
    return mutate(projectRoot, "define_cycle", (state, now) => {
        const existing = state.cycles.find((cycle) => cycle.id === input.id);
        const cycle: RpCycleDefinition = {...input, createdAt: existing?.createdAt ?? now, updatedAt: now};
        if (existing) state.cycles[state.cycles.indexOf(existing)] = cycle;
        else state.cycles.push(cycle);
        return {value: cycle, detail: {cycleId: cycle.id, subjectId: cycle.subjectId}};
    });
}

/** 计算指定 instant 的周期阶段；不逐日生成记录。 */
export async function readRpCycleAt(projectRoot: string, cycleId: string, instant: string): Promise<{cycle: RpCycleDefinition; phase: string; offsetSecond: string}> {
    const state = await readRpMechanicsState(projectRoot);
    const cycle = state.cycles.find((item) => item.id === cycleId);
    if (!cycle) throw new Error(`未找到周期：${cycleId}`);
    const length = parsePositiveBigInt(cycle.lengthSeconds, "cycle.lengthSeconds");
    const offset = modulo(parseInstantString(instant) - parseInstantString(cycle.anchorInstant), length);
    const phase = cycle.phases.find((item) => offset >= BigInt(item.startSecond) && offset < BigInt(item.endSecond));
    if (!phase) throw new Error(`周期 ${cycleId} 的阶段窗口未覆盖 offset=${offset}。`);
    return {cycle, phase: phase.label, offsetSecond: offset.toString()};
}

/** 读取账户在指定时刻的精确值与前台状态词。time_derived 不回写中间值。 */
export async function readRpResourceAt(projectRoot: string, accountId: string, instant: string): Promise<{account: RpResourceAccount; value: number; band: string | null}> {
    const state = await readRpMechanicsState(projectRoot);
    const account = requireAccount(state, accountId);
    const resource = requireResource(state, account.resourceId);
    let value = account.value;
    if (resource.kind === "time_derived" && resource.derivedRate) {
        const elapsed = parseInstantString(instant) - BigInt(account.anchorInstant);
        const numeratorSeconds = parsePositiveBigInt(resource.derivedRate.numeratorSeconds, "derivedRate.numeratorSeconds");
        const steps = elapsed / numeratorSeconds;
        value = clampInteger(value + Number(steps) * resource.derivedRate.numeratorDelta, resource);
    }
    const band = resource.bands.find((item) => value >= item.min && value <= item.max)?.label ?? null;
    return {account, value, band};
}

/**
 * 分析长跳阻断：active/suspended 事件和区间内到期硬性事件默认不可静默越过。
 * approvedEventIds 只能来自本次玩家明确处理结果，不能由 Agent 自行填入。
 */
export async function analyzeRpLongJump(
    projectRoot: string,
    startInstant: string,
    endInstant: string,
    parseEventTime: (time: string) => Promise<bigint>,
    approvedEventIds: string[] = [],
): Promise<{allowed: boolean; blockers: Array<{eventId: string; title: string; reason: string; dueAt: string | null}>}> {
    const start = parseInstantString(startInstant);
    const end = parseInstantString(endInstant);
    if (end < start) throw new Error("长跳结束时间不能早于开始时间。");
    const approved = new Set(approvedEventIds);
    const eventState = await readRpEventState(projectRoot);
    const blockers: Array<{eventId: string; title: string; reason: string; dueAt: string | null}> = [];
    for (const event of eventState.events) {
        if (approved.has(event.id)) continue;
        if (event.status === "active" || event.status === "suspended") {
            blockers.push({eventId: event.id, title: event.title, reason: `事件当前为 ${event.status}，需要先决定跳跃期间如何发展。`, dueAt: event.dueAt});
            continue;
        }
        if (!event.hard || !event.dueAt || !["available", "saved", "selected"].includes(event.status)) continue;
        const due = await parseEventTime(event.dueAt);
        if (due > start && due <= end) {
            blockers.push({eventId: event.id, title: event.title, reason: "硬性事件在跳跃区间内到期，必须暂停并询问玩家。", dueAt: event.dueAt});
        }
    }
    return {allowed: blockers.length === 0, blockers};
}

/** 玩家审批长跳阻断后建立凭证；凭证绑定当时全部阻断事件和时间范围。 */
export async function approveRpLongJump(projectRoot: string, input: {
    turnId: string;
    startInstant: string;
    endInstant: string;
    eventIds: string[];
}): Promise<RpJumpApproval> {
    return mutate(projectRoot, "approve_jump", (state, now) => {
        const start = parseInstantString(input.startInstant).toString();
        const end = parseInstantString(input.endInstant).toString();
        if (BigInt(end) < BigInt(start)) throw new Error("长跳结束时间不能早于开始时间。");
        const eventIds = [...new Set(input.eventIds.map((eventId) => requireText(eventId, "eventId")))].sort();
        const existing = state.jumpApprovals.find((approval) => approval.turnId === input.turnId && approval.startInstant === start && approval.endInstant === end);
        if (existing) return {value: existing, detail: {approvalId: existing.id, duplicate: true}};
        const approval: RpJumpApproval = {
            id: `jump-approval-${randomUUID()}`,
            turnId: requireText(input.turnId, "turnId"),
            startInstant: start,
            endInstant: end,
            eventIds,
            approvedAt: now,
        };
        state.jumpApprovals.push(approval);
        return {value: approval, detail: {approvalId: approval.id, turnId: approval.turnId, eventIds}};
    });
}

/** 提交前验证审批凭证没有被换 turn、换时间或漏掉阻断事件。 */
export async function verifyRpJumpApproval(projectRoot: string, input: {
    approvalId: string;
    turnId: string;
    startInstant: string;
    endInstant: string;
    eventIds: string[];
}): Promise<RpJumpApproval> {
    const state = await readRpMechanicsState(projectRoot);
    const approval = state.jumpApprovals.find((item) => item.id === input.approvalId);
    if (!approval) throw new Error(`未找到长跳审批凭证：${input.approvalId}`);
    const expectedIds = [...new Set(input.eventIds)].sort();
    if (approval.turnId !== input.turnId
        || approval.startInstant !== parseInstantString(input.startInstant).toString()
        || approval.endInstant !== parseInstantString(input.endInstant).toString()
        || approval.eventIds.join("\n") !== expectedIds.join("\n")) {
        throw new Error("长跳审批凭证与当前 turn、时间范围或阻断事件不匹配，必须重新询问玩家。");
    }
    return approval;
}

/**
 * committed 回合的时间与资源一次结算。长跨度只批量计算周期次数，不生成逐日 Tick。
 * turnId 严格幂等；重试直接返回首次状态。
 */
export async function settleRpMechanicsTurn(projectRoot: string, turnId: string, input: RpMechanicsSettlement): Promise<RpMechanicsState> {
    await validateRpMechanicsSettlement(projectRoot, input);
    return mutate(projectRoot, "settle_turn", (state, now) => {
        if (state.settledTurnIds.includes(turnId)) return {value: state, detail: {turnId, duplicate: true}};
        const start = parseInstantString(input.startInstant);
        const end = parseInstantString(input.endInstant);
        if (end < start) throw new Error("回合 endTime 不能早于 startTime。");
        const timeRecord: RpTimeRecord = {
            turnId,
            startInstant: start.toString(),
            endInstant: end.toString(),
            startTime: requireText(input.startTime, "startTime"),
            endTime: requireText(input.endTime, "endTime"),
            longJump: input.longJump,
            summary: requireText(input.summary, "时间结算摘要"),
            committedAt: now,
        };
        state.timeRecords.push(timeRecord);

        const directByAccount = new Map(input.resourceChanges.map((change) => [change.accountId, change]));
        for (const account of state.accounts) {
            const resource = requireResource(state, account.resourceId);
            if (resource.kind !== "time_derived") {
                for (const rule of resource.periodicRules) {
                    const occurrences = periodicOccurrences(start, end, BigInt(rule.anchorInstant), parsePositiveBigInt(rule.everySeconds, "periodic.everySeconds"));
                    if (occurrences <= 0n) continue;
                    const rawDelta = Number(occurrences) * rule.delta;
                    const nextValue = clampInteger(account.value + rawDelta, resource);
                    const applied = nextValue - account.value;
                    account.value = nextValue;
                    if (applied !== 0) state.transactions.push(transaction(turnId, account.id, "periodic", applied, account.value, `${rule.label} × ${occurrences}`, input.endInstant, input.endTime));
                }
            }
            const direct = directByAccount.get(account.id);
            if (direct) {
                const nextValue = clampInteger(account.value + direct.delta, resource);
                const applied = nextValue - account.value;
                account.value = nextValue;
                if (applied !== 0) state.transactions.push(transaction(turnId, account.id, "direct", applied, account.value, requireText(direct.reason, "资源变化原因"), input.endInstant, input.endTime));
                directByAccount.delete(account.id);
            }
            account.lastSettledInstant = end.toString();
            account.updatedAt = now;
        }
        if (directByAccount.size > 0) throw new Error(`资源账户不存在：${[...directByAccount.keys()].join(", ")}`);
        state.settledTurnIds.push(turnId);
        return {value: state, detail: {turnId, startTime: input.startTime, endTime: input.endTime, transactionCount: state.transactions.filter((item) => item.turnId === turnId).length}};
    });
}

/** 在任何文件写入前完整校验时间与资源结算引用。 */
export async function validateRpMechanicsSettlement(projectRoot: string, input: RpMechanicsSettlement): Promise<void> {
    const start = parseInstantString(input.startInstant);
    const end = parseInstantString(input.endInstant);
    if (end < start) throw new Error("回合 endTime 不能早于 startTime。");
    requireText(input.startTime, "startTime");
    requireText(input.endTime, "endTime");
    requireText(input.summary, "时间结算摘要");
    const state = await readRpMechanicsState(projectRoot);
    for (const change of input.resourceChanges) {
        requireAccount(state, change.accountId);
        if (!Number.isInteger(change.delta)) throw new Error(`资源账户 ${change.accountId} 的 delta 必须是整数最小单位。`);
        requireText(change.reason, "资源变化原因");
    }
}

/** 服务端概率结算。参数采用 ppm 整数，避免浮点与 Agent 自造随机。 */
export async function resolveRpRisk(projectRoot: string, input: {
    operationId: string;
    subjectId: string;
    kind: "pregnancy" | "custom";
    riskLevel: "none" | "low" | "medium" | "high" | "extreme";
    cycleFactorPpm: number;
    protectionFactorPpm: number;
    private: boolean;
    reason: string;
}, draw: () => number = () => rpRandomInt(1_000_000)): Promise<RpRiskResolution> {
    return mutate(projectRoot, "resolve_risk", (state, now) => {
        const existing = state.riskResolutions.find((item) => item.operationId === input.operationId);
        if (existing) return {value: existing, detail: {operationId: input.operationId, duplicate: true}};
        const basePpm = {none: 0, low: 25_000, medium: 100_000, high: 250_000, extreme: 500_000}[input.riskLevel];
        const cycleFactor = ppm(input.cycleFactorPpm, "cycleFactorPpm");
        const protectionFactor = ppm(input.protectionFactorPpm, "protectionFactorPpm");
        const probabilityPpm = Math.min(1_000_000, Math.floor(basePpm * cycleFactor / 1_000_000 * protectionFactor / 1_000_000));
        const rollPpm = draw();
        if (!Number.isInteger(rollPpm) || rollPpm < 0 || rollPpm >= 1_000_000) throw new Error("随机源必须返回 0-999999 整数。");
        const resolution: RpRiskResolution = {
            operationId: requireText(input.operationId, "operationId"), subjectId: requireText(input.subjectId, "subjectId"), kind: input.kind,
            riskLevel: input.riskLevel, probabilityPpm, rollPpm, occurred: rollPpm < probabilityPpm,
            private: input.private, reason: requireText(input.reason, "概率结算原因"), resolvedAt: now,
        };
        state.riskResolutions.push(resolution);
        return {value: resolution, detail: {operationId: input.operationId, kind: input.kind, probabilityPpm, occurred: resolution.occurred}};
    });
}

function validateResource(resource: Omit<RpResourceDefinition, "createdAt" | "updatedAt">): void {
    safeId(resource.id);
    requireText(resource.label, "资源名称");
    if (resource.min !== null && resource.max !== null && resource.min > resource.max) throw new Error("资源 min 不能大于 max。");
    for (const band of resource.bands) {
        if (band.min > band.max) throw new Error(`资源状态词 ${band.label} 的 min 不能大于 max。`);
    }
    if (resource.kind === "time_derived" && !resource.derivedRate) throw new Error("time_derived 资源必须声明 derivedRate。");
    if (resource.kind !== "time_derived" && resource.derivedRate) throw new Error("只有 time_derived 资源可以声明 derivedRate。");
    for (const rule of resource.periodicRules) {
        safeId(rule.id);
        parsePositiveBigInt(rule.everySeconds, "periodic.everySeconds");
        parseInstantString(rule.anchorInstant);
    }
}

function validateCycle(cycle: Omit<RpCycleDefinition, "createdAt" | "updatedAt">): void {
    safeId(cycle.id);
    const length = parsePositiveBigInt(cycle.lengthSeconds, "cycle.lengthSeconds");
    const sorted = [...cycle.phases].sort((a, b) => Number(BigInt(a.startSecond) - BigInt(b.startSecond)));
    let cursor = 0n;
    for (const phase of sorted) {
        const start = BigInt(phase.startSecond);
        const end = BigInt(phase.endSecond);
        if (start !== cursor || end <= start || end > length) throw new Error(`周期阶段 ${phase.label} 必须连续覆盖且位于周期长度内。`);
        cursor = end;
    }
    if (cursor !== length) throw new Error("周期阶段必须完整覆盖 cycle.lengthSeconds。");
}

function transaction(turnId: string, accountId: string, kind: "direct" | "periodic", delta: number, balance: number, reason: string, atInstant: string, atTime: string): RpMechanicsTransaction {
    return {id: `tx-${randomUUID()}`, turnId, accountId, kind, delta, balance, reason, atInstant, atTime};
}

function periodicOccurrences(start: bigint, end: bigint, anchor: bigint, every: bigint): bigint {
    if (end <= start) return 0n;
    return floorDiv(end - anchor, every) - floorDiv(start - anchor, every);
}

function floorDiv(value: bigint, divisor: bigint): bigint {
    const quotient = value / divisor;
    const remainder = value % divisor;
    return remainder < 0n ? quotient - 1n : quotient;
}

function modulo(value: bigint, divisor: bigint): bigint {
    const result = value % divisor;
    return result < 0n ? result + divisor : result;
}

function requireResource(state: RpMechanicsState, resourceId: string): RpResourceDefinition {
    const resource = state.resources.find((item) => item.id === resourceId);
    if (!resource) throw new Error(`未找到资源定义：${resourceId}`);
    return resource;
}

function requireAccount(state: RpMechanicsState, accountId: string): RpResourceAccount {
    const account = state.accounts.find((item) => item.id === accountId);
    if (!account) throw new Error(`未找到资源账户：${accountId}`);
    return account;
}

function clampInteger(value: number, resource: Pick<RpResourceDefinition, "min" | "max">): number {
    if (!Number.isInteger(value)) throw new Error("资源值必须使用整数最小单位。");
    return Math.min(resource.max ?? Number.MAX_SAFE_INTEGER, Math.max(resource.min ?? Number.MIN_SAFE_INTEGER, value));
}

function ppm(value: number, label: string): number {
    if (!Number.isInteger(value) || value < 0 || value > 1_000_000) throw new Error(`${label} 必须是 0-1000000 的整数。`);
    return value;
}

function parseInstantString(value: string): bigint {
    if (!/^-?\d+$/u.test(value)) throw new Error(`非法 instant 字符串：${value}`);
    return BigInt(value);
}

function parsePositiveBigInt(value: string, label: string): bigint {
    const parsed = parseInstantString(value);
    if (parsed <= 0n) throw new Error(`${label} 必须大于 0。`);
    return parsed;
}

function safeId(value: string): string {
    const normalized = value.trim();
    if (!/^[\p{L}\p{N}_.:-]+$/u.test(normalized)) throw new Error(`非法 id：${value}`);
    return normalized;
}

function requireText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label}不能为空。`);
    return normalized;
}

function emptyState(): RpMechanicsState {
    return {schemaVersion: 1, resources: [], accounts: [], cycles: [], transactions: [], timeRecords: [], riskResolutions: [], jumpApprovals: [], settledTurnIds: [], updatedAt: new Date(0).toISOString()};
}

async function mutate<T>(projectRoot: string, operation: string, action: (state: RpMechanicsState, now: string) => {value: T; detail: object}): Promise<T> {
    await assertAdventureRunning(projectRoot);
    const path = join(projectRoot, RP_MECHANICS_STATE_PATH);
    return withLock(path, async () => {
        const state = await readRpMechanicsState(projectRoot);
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
    if (intake.phase !== "bootstrapping" && intake.phase !== "active") throw new Error(`RP 规则系统尚不可写：当前冒险阶段为 ${intake.phase}。`);
}

async function writeAtomic(path: string, state: RpMechanicsState): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    await rename(temporary, path);
}

async function appendLedger(projectRoot: string, value: object): Promise<void> {
    const path = join(projectRoot, RP_MECHANICS_LEDGER_PATH);
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
