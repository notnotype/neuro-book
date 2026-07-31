import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {z} from "zod";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {RpIntakeOverviewDto} from "nbook/shared/dto/rp-runtime.dto";

/** Project Workspace `.nbook` 内的 RP 开团状态。正式 `rp/` 内容不在确认前写入。 */
export const RP_INTAKE_RELATIVE_PATH = ".nbook/rp/intake/state.json";

export const RP_INTAKE_FIELD_KEYS = [
    "source",
    "premise",
    "avatar",
    "playStyle",
    "systems",
    "boundaries",
    "initialMap",
    "opening",
] as const;

export type RpIntakeFieldKey = typeof RP_INTAKE_FIELD_KEYS[number];
export type RpIntakeFieldStatus = "missing" | "provisional" | "confirmed" | "conflict" | "disabled";
export type RpIntakePhase =
    | "empty"
    | "source_selected"
    | "premise_ready"
    | "avatar_ready"
    | "play_style_ready"
    | "systems_ready"
    | "boundaries_ready"
    | "opening_ready"
    | "reviewing"
    | "confirmed"
    | "bootstrapping"
    | "active";

export const RP_BOOTSTRAP_STAGES = [
    "config",
    "world",
    "map",
    "characters",
    "opening_event",
    "narrative",
] as const;

export type RpBootstrapStage = typeof RP_BOOTSTRAP_STAGES[number];
export type RpBootstrapProgress = RpBootstrapStage | "ready_to_activate" | "complete";

export type RpIntakeField = {
    status: RpIntakeFieldStatus;
    /** missing 时为 null；其余状态保存玩家回答或主持暂定提案。 */
    value: JsonValue | null;
};

export type RpIntakeState = {
    schemaVersion: 2;
    phase: RpIntakePhase;
    /** 草案内容版本。只有字段内容变化时递增。 */
    version: number;
    /** 等于 version 才能开始 Bootstrap；null 表示当前草案未确认。 */
    confirmedVersion: number | null;
    fields: Record<RpIntakeFieldKey, RpIntakeField>;
    bootstrap: {
        status: "idle" | "running" | "failed" | "complete";
        /** idle 时为 null；其余状态表示当前或最后停留的服务端阶段。 */
        stage: RpBootstrapProgress | null;
        completedStages: RpBootstrapStage[];
        /** 仅 failed 时存在，供 UI 展示失败阶段与原因。 */
        error?: {
            stage: string;
            message: string;
            at: string;
        };
    };
    createdAt: string;
    updatedAt: string;
};

const locks = new Map<string, Promise<void>>();

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
]));

const FieldSchema = z.object({
    status: z.enum(["missing", "provisional", "confirmed", "conflict", "disabled"]),
    value: JsonValueSchema.nullable(),
});

const StateSchema: z.ZodType<RpIntakeState> = z.object({
    schemaVersion: z.literal(2),
    phase: z.enum([
        "empty",
        "source_selected",
        "premise_ready",
        "avatar_ready",
        "play_style_ready",
        "systems_ready",
        "boundaries_ready",
        "opening_ready",
        "reviewing",
        "confirmed",
        "bootstrapping",
        "active",
    ]),
    version: z.number().int().nonnegative(),
    confirmedVersion: z.number().int().nonnegative().nullable(),
    fields: z.object({
        source: FieldSchema,
        premise: FieldSchema,
        avatar: FieldSchema,
        playStyle: FieldSchema,
        systems: FieldSchema,
        boundaries: FieldSchema,
        initialMap: FieldSchema,
        opening: FieldSchema,
    }),
    bootstrap: z.object({
        status: z.enum(["idle", "running", "failed", "complete"]),
        stage: z.enum([...RP_BOOTSTRAP_STAGES, "ready_to_activate", "complete"]).nullable(),
        completedStages: z.array(z.enum(RP_BOOTSTRAP_STAGES)),
        error: z.object({
            stage: z.string(),
            message: z.string(),
            at: z.string(),
        }).optional(),
    }),
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** 读取当前开团状态。文件不存在时返回未落盘的空状态。损坏文件直接报错，不静默重建。 */
export async function readRpIntake(projectRoot: string): Promise<RpIntakeState> {
    const statePath = join(projectRoot, RP_INTAKE_RELATIVE_PATH);
    let source: string;
    try {
        source = await readFile(statePath, "utf-8");
    } catch (error) {
        if (isNotFound(error)) return createEmptyState();
        throw error;
    }
    const parsed: unknown = JSON.parse(source);
    return StateSchema.parse(parsed);
}

/** 更新一个引导字段；真实内容变化会递增版本并立即使旧确认失效。 */
export async function updateRpIntakeField(
    projectRoot: string,
    key: RpIntakeFieldKey,
    field: RpIntakeField,
): Promise<RpIntakeState> {
    return withStateLock(projectRoot, async () => {
        const state = await readRpIntake(projectRoot);
        assertDraftEditable(state);
        validateField(field);
        if (sameJson(state.fields[key], field)) return state;

        const now = new Date().toISOString();
        const next: RpIntakeState = {
            ...state,
            phase: "empty",
            version: state.version + 1,
            confirmedVersion: null,
            fields: {...state.fields, [key]: field},
            bootstrap: {status: "idle", stage: null, completedStages: []},
            updatedAt: now,
        };
        next.phase = deriveDraftPhase(next);
        await persistState(projectRoot, next, true);
        return next;
    });
}

/** 所有必填项就绪后进入最终审阅。 */
export async function reviewRpIntake(projectRoot: string): Promise<RpIntakeState> {
    return withStateLock(projectRoot, async () => {
        const state = await readRpIntake(projectRoot);
        assertDraftEditable(state);
        assertReadyForReview(state);
        const next = {...state, phase: "reviewing" as const, updatedAt: new Date().toISOString()};
        await persistState(projectRoot, next, false);
        return next;
    });
}

/**
 * 记录玩家在 RP 状态页对当前企划版本的明确确认。
 * 该函数只由玩家确认 API 与测试夹具调用，不暴露给 Agent 工具。
 */
export async function confirmRpIntakeFromPlayer(projectRoot: string, version: number): Promise<RpIntakeState> {
    return withStateLock(projectRoot, async () => {
        const state = await readRpIntake(projectRoot);
        if (state.phase !== "reviewing") {
            throw new Error(`开团企划尚未进入最终审阅，当前阶段为 ${state.phase}。`);
        }
        if (state.version !== version) {
            throw new Error(`开团企划版本已变化：请求确认 v${version}，当前为 v${state.version}。请重新审阅。`);
        }
        assertReadyForReview(state);
        const next: RpIntakeState = {
            ...state,
            phase: "confirmed",
            confirmedVersion: state.version,
            fields: confirmProposals(state.fields),
            updatedAt: new Date().toISOString(),
        };
        await persistState(projectRoot, next, false);
        return next;
    });
}

/** 将完整开团草案收敛为左侧状态页可公开的运行摘要。 */
export function rpIntakeOverview(state: RpIntakeState): RpIntakeOverviewDto {
    return {
        phase: state.phase,
        version: state.version,
        confirmedVersion: state.confirmedVersion,
        bootstrap: state.bootstrap,
    };
}

/** Bootstrap 技术门禁：服务端自动绑定当前已由玩家确认的草案版本。 */
export async function beginRpBootstrap(projectRoot: string): Promise<RpIntakeState> {
    return withStateLock(projectRoot, async () => {
        const state = await readRpIntake(projectRoot);
        if (state.phase === "bootstrapping" && state.confirmedVersion === state.version) {
            if (state.bootstrap.status !== "failed") return state;
            const next: RpIntakeState = {
                ...state,
                bootstrap: {
                    status: "running",
                    stage: state.bootstrap.stage ?? "config",
                    completedStages: state.bootstrap.completedStages,
                },
                updatedAt: new Date().toISOString(),
            };
            await persistState(projectRoot, next, false);
            return next;
        }
        if (state.phase !== "confirmed" || state.confirmedVersion !== state.version) {
            throw new Error(`Bootstrap 被拒绝：当前企划 v${state.version} 尚未以同版本确认。`);
        }
        const next: RpIntakeState = {
            ...state,
            phase: "bootstrapping",
            bootstrap: {status: "running", stage: "config", completedStages: []},
            updatedAt: new Date().toISOString(),
        };
        await persistState(projectRoot, next, false);
        return next;
    });
}

/** 初始化失败后停留在原阶段；只开放该阶段写面，并允许修正后直接重试 checkpoint。 */
export async function failRpBootstrap(projectRoot: string, message: string): Promise<RpIntakeState> {
    return withStateLock(projectRoot, async () => {
        const state = await readRpIntake(projectRoot);
        if (state.phase !== "bootstrapping") throw new Error(`当前阶段 ${state.phase} 没有正在进行的 Bootstrap。`);
        const stage = state.bootstrap.stage ?? "config";
        const now = new Date().toISOString();
        const next: RpIntakeState = {
            ...state,
            phase: "bootstrapping",
            bootstrap: {
                status: "failed",
                stage,
                completedStages: state.bootstrap.completedStages,
                error: {stage, message, at: now},
            },
            updatedAt: now,
        };
        await persistState(projectRoot, next, false);
        return next;
    });
}

/** 服务端完成当前 Bootstrap 阶段；只能按固定顺序相邻推进。 */
export async function completeRpBootstrapStage(projectRoot: string, stage: RpBootstrapStage): Promise<RpIntakeState> {
    return withStateLock(projectRoot, async () => {
        const state = await readRpIntake(projectRoot);
        if (state.phase !== "bootstrapping" || (state.bootstrap.status !== "running" && state.bootstrap.status !== "failed")) {
            throw new Error(`当前阶段 ${state.phase} 没有可推进的 Bootstrap。`);
        }
        if (state.bootstrap.stage !== stage) throw new Error(`Bootstrap 当前应完成 ${state.bootstrap.stage}，不能跳到 ${stage}。`);
        const index = RP_BOOTSTRAP_STAGES.indexOf(stage);
        const completedStages = RP_BOOTSTRAP_STAGES.slice(0, index + 1);
        const nextStage: RpBootstrapProgress = RP_BOOTSTRAP_STAGES[index + 1] ?? "ready_to_activate";
        const next: RpIntakeState = {
            ...state,
            bootstrap: {status: "running", stage: nextStage, completedStages: [...completedStages]},
            updatedAt: new Date().toISOString(),
        };
        await persistState(projectRoot, next, false);
        return next;
    });
}

/** 全量验收和开场正文发布成功后，将冒险标记为 active。 */
export async function completeRpBootstrap(projectRoot: string): Promise<RpIntakeState> {
    return withStateLock(projectRoot, async () => {
        const state = await readRpIntake(projectRoot);
        if (state.phase === "active") return state;
        if (state.phase !== "bootstrapping" || state.bootstrap.stage !== "ready_to_activate" || state.confirmedVersion !== state.version) {
            throw new Error(`无法激活 RP：Bootstrap 尚未完成全部服务端阶段。`);
        }
        const next: RpIntakeState = {
            ...state,
            phase: "active",
            bootstrap: {status: "complete", stage: "complete", completedStages: [...RP_BOOTSTRAP_STAGES]},
            updatedAt: new Date().toISOString(),
        };
        await persistState(projectRoot, next, false);
        return next;
    });
}

/** 正式 RP 写入和 RP 子 Agent 初始化共用的硬门禁。 */
export async function assertRpRuntimeWritable(projectRoot: string): Promise<RpIntakeState> {
    const state = await readRpIntake(projectRoot);
    if (state.phase !== "bootstrapping" && state.phase !== "active") {
        throw new Error(`RP 正式运行写入被拒绝：开团企划仍处于 ${state.phase}，请先完成审阅与用户确认。`);
    }
    if (state.confirmedVersion !== state.version) {
        throw new Error(`RP 正式运行写入被拒绝：确认版本与当前企划版本不一致。`);
    }
    return state;
}

/** active 冒险始终放行；Bootstrap 只允许当前服务端阶段对应的领域操作。 */
export async function assertRpBootstrapStage(projectRoot: string, allowedStages: RpBootstrapStage[]): Promise<RpIntakeState> {
    const state = await assertRpRuntimeWritable(projectRoot);
    if (state.phase === "active") return state;
    const stage = state.bootstrap.stage;
    if (!stage || !allowedStages.includes(stage as RpBootstrapStage)) {
        throw new Error(`RP Bootstrap 当前阶段为 ${stage ?? "unknown"}，此操作只允许在 ${allowedStages.join("、")} 阶段执行。`);
    }
    return state;
}

function createEmptyState(): RpIntakeState {
    const now = new Date().toISOString();
    const missing = (): RpIntakeField => ({status: "missing", value: null});
    return {
        schemaVersion: 2,
        phase: "empty",
        version: 0,
        confirmedVersion: null,
        fields: {
            source: missing(),
            premise: missing(),
            avatar: missing(),
            playStyle: missing(),
            systems: missing(),
            boundaries: missing(),
            initialMap: missing(),
            opening: missing(),
        },
        bootstrap: {status: "idle", stage: null, completedStages: []},
        createdAt: now,
        updatedAt: now,
    };
}

function deriveDraftPhase(state: RpIntakeState): RpIntakePhase {
    if (!resolved(state.fields.source)) return "empty";
    if (!resolved(state.fields.premise)) return "source_selected";
    if (!resolved(state.fields.avatar)) return "premise_ready";
    if (!resolved(state.fields.playStyle)) return "avatar_ready";
    if (!resolved(state.fields.systems)) return "play_style_ready";
    if (!resolved(state.fields.boundaries)) return "systems_ready";
    if (!resolved(state.fields.initialMap) || !resolved(state.fields.opening)) return "boundaries_ready";
    return "opening_ready";
}

function resolved(field: RpIntakeField): boolean {
    return field.status === "confirmed" || field.status === "provisional" || field.status === "disabled";
}

function validateField(field: RpIntakeField): void {
    if (field.status === "missing" && field.value !== null) throw new Error("missing 字段的 value 必须为 null。");
    if (field.status !== "missing" && field.value === null) throw new Error(`${field.status} 字段必须提供 value。`);
}

function assertDraftEditable(state: RpIntakeState): void {
    if (state.phase === "bootstrapping" || state.phase === "active") {
        throw new Error(`当前 RP 已处于 ${state.phase}，不能通过开团草案修改正式世界。`);
    }
}

function assertReadyForReview(state: RpIntakeState): void {
    const missing = RP_INTAKE_FIELD_KEYS.filter((key) => !resolved(state.fields[key]));
    if (missing.length > 0) throw new Error(`开团企划尚未完成：${missing.join("、")}。`);
}

function confirmProposals(fields: RpIntakeState["fields"]): RpIntakeState["fields"] {
    return Object.fromEntries(RP_INTAKE_FIELD_KEYS.map((key) => [
        key,
        fields[key].status === "provisional" ? {...fields[key], status: "confirmed" as const} : fields[key],
    ])) as RpIntakeState["fields"];
}

async function persistState(projectRoot: string, state: RpIntakeState, saveVersion: boolean): Promise<void> {
    const statePath = join(projectRoot, RP_INTAKE_RELATIVE_PATH);
    await writeJsonAtomic(statePath, state);
    if (saveVersion) {
        const versionPath = join(projectRoot, ".nbook/rp/intake/versions", `${String(state.version).padStart(6, "0")}.json`);
        await writeJsonAtomic(versionPath, state);
    }
}

async function writeJsonAtomic(path: string, value: RpIntakeState): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    await rename(temporaryPath, path);
}

async function withStateLock<T>(projectRoot: string, action: () => Promise<T>): Promise<T> {
    const statePath = join(projectRoot, RP_INTAKE_RELATIVE_PATH);
    const previous = locks.get(statePath) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.then(() => current);
    locks.set(statePath, tail);
    await previous;
    try {
        return await action();
    } finally {
        release();
        if (locks.get(statePath) === tail) locks.delete(statePath);
    }
}

function sameJson(left: RpIntakeField, right: RpIntakeField): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}
