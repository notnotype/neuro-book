/**
 * 诊断记录能力：有界内存记录、过滤查询、降级状态与阶段推进。
 *
 * 装配方在 `createApplication` 之前创建 store，使启动初期的生命周期/装配/插件事件先进入缓冲；
 * 插件激活时再把出口接到缓冲之后（记录能力先于订阅）。store 只拥有内存缓冲与出口句柄：
 * 不扫描共享目录、不重建历史记录、不因关闭而删除任何持久数据。
 */

import type {RuntimeInstanceIdentity} from "../lifecycle/lifecycle";
import type {EmergencyReport, MechanismObservers} from "../application/application";
import type {AssemblyDiagnostic} from "../services/services";
import type {PluginDiagnostic} from "../plugins/plugins";

import type {
    AttachDiagnosticsInput,
    DiagnosticExporter,
    DiagnosticFallback,
    DiagnosticInput,
    DiagnosticLevel,
    DiagnosticQuery,
    DiagnosticQueryResult,
    DiagnosticRecord,
    DiagnosticsBudget,
    DiagnosticsDegraded,
    DiagnosticsPhase,
    DiagnosticsService,
    DiagnosticsStatus,
    DiagnosticsStore,
    DiagnosticsStoreOptions,
    EffectiveDiagnosticsBudget,
    ExporterState,
    RecordReceipt,
} from "./contracts";
import {DiagnosticsError} from "./contracts";
import {MAX_STRING_LENGTH, describeDiagnosticError, redactText, sanitizeDiagnosticValue, serializeDiagnosticError} from "./redaction";

const DEFAULT_MAX_RECORDS = 1000;
const LEVELS: ReadonlyArray<DiagnosticLevel> = ["debug", "info", "warn", "error", "fatal"];

/** 合法级别登记表；用 Record 表示静态字面量，`Object.hasOwn` 保证不认原型链上的键。 */
const LEVEL_FLAGS: Readonly<Record<DiagnosticLevel, true>> = {debug: true, info: true, warn: true, error: true, fatal: true};

/** 级别按严重度排序；门禁、降级兜底与 `minLevel` 过滤都以它为准，不看文案。 */
const LEVEL_SEVERITY: Readonly<Record<DiagnosticLevel, number>> = {debug: 0, info: 1, warn: 2, error: 3, fatal: 4};

function positiveInteger(value: number, label: string): number {
    if (!Number.isInteger(value) || value <= 0) {
        throw new TypeError(`${label} 必须是有限正整数，收到 ${String(value)}`);
    }
    return value;
}

function isDiagnosticLevel(value: unknown): value is DiagnosticLevel {
    return typeof value === "string" && Object.hasOwn(LEVEL_FLAGS, value);
}

function requireLevel(value: DiagnosticLevel, label: string): DiagnosticLevel {
    if (!isDiagnosticLevel(value)) {
        throw new TypeError(`${label} 必须是 debug/info/warn/error/fatal，收到 ${String(value)}`);
    }
    return value;
}

function requireText(value: string | undefined, label: string): string | null {
    if (value === undefined) {
        return null;
    }
    if (typeof value !== "string") {
        throw new TypeError(`${label} 必须是字符串`);
    }
    return value;
}

/** 建立一个运行实例的诊断记录能力；同一实例只创建一次。 */
export function createDiagnosticsStore(options: DiagnosticsStoreOptions): DiagnosticsStore {
    // 预算在装配期解析并校验：非有限正整数是装配错误，不能变成运行期静默降级。
    const budget: EffectiveDiagnosticsBudget = {
        maxRecords: positiveInteger(options.budget?.maxRecords ?? DEFAULT_MAX_RECORDS, "budget.maxRecords"),
        maxMessageChars: positiveInteger(options.budget?.maxMessageChars ?? MAX_STRING_LENGTH, "budget.maxMessageChars"),
    };
    return new DiagnosticsStoreImpl(options.identity, budget, options.now ?? (() => new Date()));
}

class DiagnosticsStoreImpl implements DiagnosticsStore {
    readonly identity: RuntimeInstanceIdentity;
    readonly #budget: EffectiveDiagnosticsBudget;
    readonly #now: () => Date;
    readonly #records: DiagnosticRecord[] = [];
    #sequence = 0;
    #evicted = 0;
    #phase: DiagnosticsPhase = "creating";
    #degraded: DiagnosticsDegraded | null = null;
    #exporter: DiagnosticExporter | null = null;
    #exporterState: ExporterState = "closed";
    #fallback: DiagnosticFallback | null = null;
    /** 出口写入队列：保证落盘顺序，且队列表决的写失败不会回流到调用方。 */
    #writes: Promise<void> = Promise.resolve();
    #closing: Promise<void> | null = null;
    #closed = false;

    constructor(identity: RuntimeInstanceIdentity, budget: EffectiveDiagnosticsBudget, now: () => Date) {
        this.identity = identity;
        this.#budget = budget;
        this.#now = now;
    }

    record(input: DiagnosticInput): RecordReceipt {
        if (this.#closed) {
            return {status: "rejected", reason: "closed"};
        }
        if (this.#phase === "stopping") {
            return {status: "rejected", reason: "stopping"};
        }
        let record: DiagnosticRecord;
        try {
            if (!isDiagnosticLevel(input.level) || typeof input.event !== "string" || input.event === "" || typeof input.message !== "string") {
                return {status: "rejected", reason: "invalid-input"};
            }
            record = this.#build(input, this.#sequence + 1);
        } catch {
            // 连读取输入都失败（例如恶意 getter）与输入非法同义：不抛，也不消耗序号。
            return {status: "rejected", reason: "invalid-input"};
        }
        this.#sequence = record.sequence;
        this.#retain(record);
        this.#dispatch(record);
        return {status: "accepted", sequence: record.sequence};
    }

    query(options: DiagnosticQuery = {}): DiagnosticQueryResult {
        const limit = options.limit === undefined ? null : positiveInteger(options.limit, "query.limit");
        const minLevel = options.minLevel === undefined ? null : requireLevel(options.minLevel, "query.minLevel");
        const levels = options.levels === undefined ? null : new Set(options.levels.map((level) => requireLevel(level, "query.levels")));
        const event = requireText(options.event, "query.event");
        const plugin = requireText(options.plugin, "query.plugin");
        const service = requireText(options.service, "query.service");
        const scopeId = requireText(options.scopeId, "query.scopeId");
        const matched = this.#records.filter((record) => {
            if (levels !== null && !levels.has(record.level)) {
                return false;
            }
            if (minLevel !== null && LEVEL_SEVERITY[record.level] < LEVEL_SEVERITY[minLevel]) {
                return false;
            }
            if (event !== null && record.event !== event) {
                return false;
            }
            if (plugin !== null && record.origin.plugin !== plugin) {
                return false;
            }
            if (service !== null && record.origin.service !== service) {
                return false;
            }
            return scopeId === null || record.origin.scopeId === scopeId;
        });
        const truncatedByLimit = limit !== null && matched.length > limit;
        return {
            records: truncatedByLimit ? matched.slice(matched.length - limit!) : matched,
            evicted: this.#evicted,
            truncatedByLimit,
        };
    }

    status(): DiagnosticsStatus {
        return {
            phase: this.#phase,
            degraded: this.#degraded === null ? null : {...this.#degraded},
            budget: {...this.#budget},
            retained: this.#records.length,
            evicted: this.#evicted,
            exporter: {kind: this.#exporter?.kind ?? null, state: this.#exporterState},
        };
    }

    async attach(input: AttachDiagnosticsInput): Promise<void> {
        if (this.#closed) {
            throw new DiagnosticsError({
                code: "closed",
                message: `诊断实例 ${this.identity.instanceId} 已关闭，不能在新的激活中复活`,
            });
        }
        if (this.#phase !== "creating") {
            throw new DiagnosticsError({code: "already-attached", message: `诊断实例 ${this.identity.instanceId} 已挂接出口`, detail: this.#phase});
        }
        this.#fallback = input.fallback;
        if (input.outcome.status === "degraded") {
            this.#exporter = null;
            this.#degrade(input.outcome.reason, input.outcome.detail);
        } else {
            this.#exporter = input.outcome.exporter;
            this.#exporterState = "open";
            const degraded = input.outcome.degraded;
            if (degraded !== undefined) {
                // 出口运行中自行失效（例如日志位置授予被抢占）：进入降级而不是静默继续写。
                void degraded.then(
                    (reason) => this.#degrade(reason.reason, reason.detail),
                    (error: unknown) => this.#degrade("exporter-degraded-signal-failed", describeDiagnosticError(error)),
                );
            }
        }
        this.#phase = "available";
        // 记录能力先于订阅：激活前缓冲的记录按顺序补写（已降级时由 #dispatch 决定走兜底或只留在内存）。
        for (const record of [...this.#records]) {
            this.#dispatch(record);
        }
    }

    async flush(): Promise<void> {
        await this.#writes;
    }

    shutdown(): Promise<void> {
        if (this.#closed) {
            return Promise.resolve();
        }
        if (this.#closing !== null) {
            // 上一次收口仍 pending：观察同一结果，不与它重入或并发重跑。
            return this.#closing;
        }
        this.#phase = "stopping";
        this.#closing = this.#close();
        return this.#closing;
    }

    async #close(): Promise<void> {
        try {
            await this.#writes;
            const exporter = this.#exporter;
            if (exporter !== null) {
                try {
                    await exporter.close();
                } catch (error) {
                    const detail = describeDiagnosticError(error);
                    this.#degrade("exporter-close-failed", detail, "close-failed");
                    throw new DiagnosticsError({
                        code: "close-incomplete",
                        message: `诊断出口关闭未完成：${this.identity.instanceId}`,
                        detail,
                        cause: error,
                    });
                }
            }
            this.#closed = true;
            this.#phase = "closed";
            this.#exporterState = "closed";
        } finally {
            // 失败后清空在途标记：只有显式恢复（再次 shutdown）才另起一次尝试，之后只重试失败的那一步。
            this.#closing = null;
        }
    }

    #build(input: DiagnosticInput, sequence: number): DiagnosticRecord {
        const source = input.source;
        return {
            sequence,
            timestamp: this.#timestamp(),
            level: input.level,
            event: input.event,
            message: redactText(input.message, this.#budget.maxMessageChars),
            data: input.data === undefined ? null : sanitizeDiagnosticValue(input.data),
            error: input.error === undefined ? null : serializeDiagnosticError(input.error),
            origin: {
                location: this.identity.location,
                instanceId: this.identity.instanceId,
                scopeId: source?.scopeId ?? null,
                plugin: source?.plugin ?? null,
                entry: source?.entry ?? null,
                service: source?.service ?? null,
                stage: source?.stage ?? null,
                transition: source?.transition ?? null,
                correlation: source?.correlation ?? null,
            },
        };
    }

    #timestamp(): string {
        try {
            const value = this.#now();
            if (Number.isFinite(value.getTime())) {
                return value.toISOString();
            }
        } catch {
            // 时间来源异常不改变记录结果：退回真实时钟，仍不抛。
        }
        return new Date().toISOString();
    }

    #retain(record: DiagnosticRecord): void {
        this.#records.push(record);
        const overflow = this.#records.length - this.#budget.maxRecords;
        if (overflow > 0) {
            this.#records.splice(0, overflow);
            this.#evicted += overflow;
        }
    }

    #dispatch(record: DiagnosticRecord): void {
        const exporter = this.#exporter;
        if (exporter !== null && this.#degraded === null) {
            this.#writes = this.#writes.then(async () => {
                // 队列中更早的记录可能已让出口降级：此后不再写，记录仍留在内存缓冲里。
                if (this.#degraded !== null || this.#closed) {
                    return;
                }
                try {
                    await exporter.write(record);
                } catch (error) {
                    this.#degrade("exporter-write-failed", describeDiagnosticError(error));
                }
            });
            return;
        }
        // 首选出口不可用或已降级：只有 error/fatal 走紧急最小输出，其余级别只留在内存记录里。
        if (this.#degraded === null || LEVEL_SEVERITY[record.level] < LEVEL_SEVERITY.error || this.#fallback === null) {
            return;
        }
        try {
            this.#fallback(record);
        } catch {
            // 兜底通道自身异常不得改变记录结果，也不得触发第二次上报。
        }
    }

    /** 标记降级：原因可查询且只在首次降级时记录，之后 error/fatal 记录走兜底通道。 */
    #degrade(reason: string, detail: string | null, state: ExporterState = "degraded"): void {
        if (this.#closed) {
            return;
        }
        if (this.#degraded === null) {
            this.#degraded = {reason, detail};
        }
        this.#exporterState = state;
    }
}

/**
 * 机制事件观察者：把 lifecycle 阶段与失败、services 装配诊断、plugins 插件诊断转成记录，
 * 使启动初期的失败在任何业务插件激活前就进入缓冲。回调不抛（各机制也会吞掉异常）。
 */
export function mechanismObservers(store: DiagnosticsService): MechanismObservers {
    return {
        lifecycle: {
            phaseChanged: (change) => {
                store.record({
                    level: change.to === "creating" ? "debug" : "info",
                    event: "lifecycle.phase-changed",
                    message: `作用域 ${change.scopeId} ${change.from} → ${change.to}`,
                    data: {sequence: change.sequence, scopeId: change.scopeId, from: change.from, to: change.to},
                    source: {scopeId: change.scopeId, stage: "phase", transition: `${change.from}->${change.to}`},
                });
            },
            failureRecorded: (failure) => {
                store.record({
                    // 获取失败可能是可选依赖，记 warn；释放与关闭失败会让收口停在停止中，记 error。
                    level: failure.stage === "acquire" ? "warn" : "error",
                    event: "lifecycle.failure",
                    message: `作用域 ${failure.scopeId} 在 ${failure.stage} 阶段失败：${failure.error.name}: ${failure.error.message}`,
                    data: {sequence: failure.sequence, phase: failure.phase, stage: failure.stage, attempt: failure.attempt, resourceId: failure.resourceId},
                    error: failure.error,
                    source: {scopeId: failure.scopeId, stage: failure.stage},
                });
            },
        },
        services: {
            diagnosticRecorded: (diagnostic) => {
                store.record({
                    level: severityForServiceDiagnostic(diagnostic),
                    event: "services.diagnostic",
                    message: `${diagnostic.stage} ${diagnostic.key ?? diagnostic.entryId ?? "assembly"}：${diagnostic.reason}`,
                    data: {
                        sequence: diagnostic.sequence,
                        scopeId: diagnostic.scopeId,
                        key: diagnostic.key,
                        entryId: diagnostic.entryId,
                        stage: diagnostic.stage,
                        reason: diagnostic.reason,
                    },
                    error: diagnostic.error,
                    source: {
                        scopeId: diagnostic.scopeId ?? undefined,
                        service: diagnostic.key ?? undefined,
                        entry: diagnostic.entryId ?? undefined,
                        stage: diagnostic.stage,
                    },
                });
            },
        },
        plugins: {
            diagnosticRecorded: (diagnostic) => {
                store.record({
                    level: severityForPluginDiagnostic(diagnostic),
                    event: "plugins.diagnostic",
                    message: `${diagnostic.stage} ${diagnostic.plugin ?? "plugin"}/${diagnostic.entry ?? "entry"}：${diagnostic.reason}`,
                    data: {
                        sequence: diagnostic.sequence,
                        plugin: diagnostic.plugin,
                        entry: diagnostic.entry,
                        generation: diagnostic.generation,
                        stage: diagnostic.stage,
                        reason: diagnostic.reason,
                        capability: diagnostic.capability,
                        contribution: diagnostic.contribution,
                    },
                    error: diagnostic.error,
                    source: {
                        plugin: diagnostic.plugin ?? undefined,
                        entry: diagnostic.entry ?? undefined,
                        stage: diagnostic.stage,
                        correlation: diagnostic.generation === null ? undefined : `${diagnostic.plugin}/${diagnostic.entry}#${diagnostic.generation}`,
                    },
                });
            },
        },
    };
}

/**
 * 包装宿主紧急输出：先把报告记入诊断缓冲再转发给宿主。必需门禁失败时内核在停止之前发出
 * 紧急报告，因此启动失败能在 store 收口前进入结构化记录；记录失败或被拒绝都不影响转发。
 */
export function recordingEmergency(store: DiagnosticsService, emergency: (report: EmergencyReport) => void): (report: EmergencyReport) => void {
    return (report) => {
        store.record({
            level: "fatal",
            event: `application.${report.stage}-emergency`,
            message: report.reason,
            data: {detail: report.detail},
            source: {stage: report.stage},
        });
        emergency(report);
    };
}

/** 初始化失败记 error；解析与恢复失败记 warn；声明与解析成功记 debug，其余成功路径记 info。 */
function severityForServiceDiagnostic(diagnostic: AssemblyDiagnostic): DiagnosticLevel {
    if (diagnostic.error !== null) {
        return diagnostic.stage === "initialize" ? "error" : "warn";
    }
    return diagnostic.stage === "declare" || diagnostic.stage === "resolve" ? "debug" : "info";
}

/** 激活/发布失败记 error；撤回与恢复问题记 warn；登记记 debug，其余成功路径记 info。 */
function severityForPluginDiagnostic(diagnostic: PluginDiagnostic): DiagnosticLevel {
    if (diagnostic.error !== null) {
        return diagnostic.stage === "revoke" ? "warn" : "error";
    }
    if (diagnostic.stage === "revoke") {
        return "warn";
    }
    return diagnostic.stage === "register" ? "debug" : "info";
}
