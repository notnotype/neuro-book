/**
 * runtime.diagnostics 的公开合同：级别、记录、收据、查询、预算、状态、服务键与出口。
 *
 * 除 `DiagnosticsError` 外本文件只有类型；行为合同见 docs/specs/runtime/diagnostics.md。
 */

import type {RuntimeInstanceIdentity, RuntimeLocation} from "../lifecycle/lifecycle";

export type DiagnosticLevel = "debug" | "info" | "warn" | "error" | "fatal";

/** 调用方可给出的来源信息；`location` 与 `instanceId` 由提供者写入，调用方不能覆盖。 */
export interface DiagnosticSourceInput {
    readonly scopeId?: string;
    readonly plugin?: string;
    readonly entry?: string;
    readonly service?: string;
    readonly stage?: string;
    readonly transition?: string;
    readonly correlation?: string;
}

export interface DiagnosticInput {
    readonly level: DiagnosticLevel;
    readonly event: string;
    readonly message: string;
    /** 结构化数据；写盘前脱敏并按深度/条目上限收敛。 */
    readonly data?: unknown;
    /** 错误对象；序列化为只含名称、消息与栈的安全结构。 */
    readonly error?: unknown;
    readonly source?: DiagnosticSourceInput;
}

/** 记录来源：提供者写入的位置与实例身份 + 调用方来源；缺失字段为 null（未知）。 */
export interface DiagnosticOrigin {
    readonly location: RuntimeLocation;
    readonly instanceId: string;
    readonly scopeId: string | null;
    readonly plugin: string | null;
    readonly entry: string | null;
    readonly service: string | null;
    readonly stage: string | null;
    readonly transition: string | null;
    readonly correlation: string | null;
}

export interface DiagnosticRecord {
    /** 本实例内单调递增；只有被接受的记录才消耗序号。 */
    readonly sequence: number;
    readonly timestamp: string;
    readonly level: DiagnosticLevel;
    readonly event: string;
    /** 已脱敏并按预算截断。 */
    readonly message: string;
    /** 已脱敏；调用方未提供为 null。 */
    readonly data: unknown;
    /** 已序列化；调用方未提供为 null。 */
    readonly error: unknown;
    readonly origin: DiagnosticOrigin;
}

export type RecordRejectionReason = "stopping" | "closed" | "invalid-input";

export type RecordReceipt =
    | {readonly status: "accepted"; readonly sequence: number}
    | {readonly status: "rejected"; readonly reason: RecordRejectionReason};

export interface DiagnosticQuery {
    /** 显式级别集合；与 `minLevel` 同时给出时取交集。 */
    readonly levels?: ReadonlyArray<DiagnosticLevel>;
    readonly minLevel?: DiagnosticLevel;
    readonly event?: string;
    readonly plugin?: string;
    readonly service?: string;
    readonly scopeId?: string;
    /** 最近 N 条；必须是有限正整数。 */
    readonly limit?: number;
}

export interface DiagnosticQueryResult {
    /** 时间升序；`limit` 截取最近 N 条。 */
    readonly records: ReadonlyArray<DiagnosticRecord>;
    /** 本实例累计淘汰条数。 */
    readonly evicted: number;
    readonly truncatedByLimit: boolean;
}

export interface DiagnosticsBudget {
    readonly maxRecords: number;
    /** 单条消息的长度上限；缺省 `MAX_STRING_LENGTH`。 */
    readonly maxMessageChars?: number;
}

/** 生效预算：省略项已解析，两个上限都是有限正整数。 */
export interface EffectiveDiagnosticsBudget {
    readonly maxRecords: number;
    readonly maxMessageChars: number;
}

export type DiagnosticsPhase = "creating" | "available" | "stopping" | "closed";

/** 降级原因；`reason` 是程序分支依据，`detail` 是人类细节（已脱敏）。 */
export interface DiagnosticsDegraded {
    readonly reason: string;
    readonly detail: string | null;
}

export type ExporterState = "open" | "degraded" | "closed" | "close-failed";

export interface DiagnosticsStatus {
    readonly phase: DiagnosticsPhase;
    /** 首选出口不可用或已失效时为非空；未降级为 null。 */
    readonly degraded: DiagnosticsDegraded | null;
    readonly budget: EffectiveDiagnosticsBudget;
    /** 当前内存记录条数。 */
    readonly retained: number;
    readonly evicted: number;
    /** `kind` 为 null 表示尚未挂接出口，此时 state 为 closed（没有可写通道）。 */
    readonly exporter: {readonly kind: string | null; readonly state: ExporterState};
}

export interface DiagnosticsService {
    /** 永不抛：出口失败、出口缺失、实例已收口都只反映在收据与状态里。 */
    record(input: DiagnosticInput): RecordReceipt;
    /** 只读本实例有界内存记录，不扫描任何共享目录。 */
    query(query?: DiagnosticQuery): DiagnosticQueryResult;
    status(): DiagnosticsStatus;
}

export interface DiagnosticExporter {
    readonly kind: string;
    write(record: DiagnosticRecord): void | Promise<void>;
    /** 幂等；显式恢复只重试失败的那一步，不与在途关闭并发。 */
    close(): Promise<void>;
}

/** 宿主紧急最小输出通道；不得抛错，也不复制完整日志职责。 */
export type DiagnosticFallback = (record: DiagnosticRecord) => void;

export interface DiagnosticExporterContext {
    /** 本次激活的停止信号。 */
    readonly signal: AbortSignal;
}

export type ExporterOpenOutcome =
    | {
          readonly status: "open";
          readonly exporter: DiagnosticExporter;
          /** 出口在运行中自行失效（例如日志位置授予被抢占）时兑现；诊断提供者据此进入降级。 */
          readonly degraded?: Promise<DiagnosticsDegraded>;
      }
    | {readonly status: "degraded"; readonly reason: string; readonly detail: string | null};

export type DiagnosticExporterFactory = (context: DiagnosticExporterContext) => Promise<ExporterOpenOutcome>;

export interface AttachDiagnosticsInput {
    readonly outcome: ExporterOpenOutcome;
    readonly fallback: DiagnosticFallback;
}

export interface DiagnosticsStoreOptions {
    readonly identity: RuntimeInstanceIdentity;
    readonly budget?: DiagnosticsBudget;
    /** 记录时间来源；缺省系统时钟。 */
    readonly now?: () => Date;
}

/**
 * 装配方在 `createApplication` 之前创建的记录能力：先建立内存缓冲，插件激活时再挂接出口。
 * `attach`/`shutdown` 是管理面（装配方与插件用），消费者只经 `DiagnosticsService` 使用。
 */
export interface DiagnosticsStore extends DiagnosticsService {
    readonly identity: RuntimeInstanceIdentity;
    /** 挂接出口并把激活前缓冲的记录按顺序补写；出口不可用只记录降级，不抛。 */
    attach(input: AttachDiagnosticsInput): Promise<void>;
    /** 等待已接受的记录在出口队列里结算（已降级或未挂接时为当次队列）；装配验收与测试用。 */
    flush(): Promise<void>;
    /** 进入停止中、补写并关闭出口；关闭失败抛 `close-incomplete` 并保留在停止中。 */
    shutdown(): Promise<void>;
}

export type DiagnosticsErrorCode = "closed" | "already-attached" | "close-incomplete";

/** 诊断实例阶段不允许所请求动作、或关闭未完成时抛出；调用方按 `code` 分支。 */
export class DiagnosticsError extends Error {
    readonly code: DiagnosticsErrorCode;
    readonly detail: string | null;

    constructor(input: {readonly code: DiagnosticsErrorCode; readonly message: string; readonly detail?: string; readonly cause?: unknown}) {
        super(input.message, input.cause === undefined ? undefined : {cause: input.cause});
        this.name = "DiagnosticsError";
        this.code = input.code;
        this.detail = input.detail ?? null;
    }
}
