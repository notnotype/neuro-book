/**
 * runtime.application 内核的公开合同：宿主上下文、装配清单、启动门禁、接纳与停止结果。
 *
 * 只有类型；没有可执行副作用。行为合同见 docs/specs/runtime/application.md。
 * 环境适配器（server/runtime、app/runtime）把宿主事件翻译成这里的 HostContext，再消费 Application。
 */

import type {
    CloseIncomplete,
    CloseRequest,
    FailureError,
    LifecycleObserver,
    OperationHandle,
    OperationSpec,
    RuntimeInstanceIdentity,
    Scope,
    ScopePhase,
} from "../lifecycle/lifecycle";
import type {EntryRef, PluginDefinition, PluginHost, PluginObserver} from "../plugins/plugins";
import type {AssemblyObserver, ServiceAccess, ServiceAssembly, ServiceCreateContext, ServiceDependency, ServiceKey} from "../services/services";

export type {FailureError} from "../lifecycle/lifecycle";

/** 紧急输出：诊断插件未就绪或失败时仍能报告的最小错误；只含脱敏字段。 */
export interface EmergencyReport {
    readonly instanceId: string;
    readonly stage: "startup" | "stop";
    readonly reason: string;
    readonly detail: string | null;
}

/**
 * 宿主上下文：只提供实例身份、停止来源与最小输出。根定位、凭据与进程管理权限由环境边界先验证，
 * 内核不扫描 cwd、用户目录或网络。
 */
export interface HostContext {
    readonly identity: RuntimeInstanceIdentity;
    /** 宿主要求停止（进程信号、页面销毁、验收脚本）；触发即进入停止。 */
    readonly stopSignal: AbortSignal;
    /**
     * 宿主给首次停止的截止（有界终止由拥有进程/页面的宿主执行）：内核在首次停止开始时调用一次，
     * 返回的信号触发后本次停止尝试结算为 `incomplete(deadline)`，已在跑的释放继续跑、不被撤销也不重入。
     * 不作用于显式恢复。
     */
    readonly stopDeadline?: () => AbortSignal;
    emergency(report: EmergencyReport): void;
}

/** 装配方提供的本地能力：以根作用域为 owner 的服务提供者（例如后端的进程能力、浏览器的远端协议代理）。 */
export interface CapabilityProvider<T = unknown> {
    readonly id: string;
    readonly key: ServiceKey<T>;
    readonly dependencies?: ReadonlyArray<ServiceDependency>;
    create(context: ServiceCreateContext): T | Promise<T>;
    release?(instance: T): void | Promise<void>;
}

/** 只读检查门禁的上下文：停止信号、根作用域与该门禁声明依赖的服务访问。 */
export interface GateCheckContext {
    readonly signal: AbortSignal;
    readonly root: Scope;
    /** 只能解析本门禁 `dependencies` 声明过的键；借用登记在根作用域上。 */
    readonly services: ServiceAccess;
}

/** 启动门禁：装配方声明的就绪条件；`required` 默认 true。 */
export type StartupGate =
    | {readonly id: string; readonly required?: boolean; readonly kind: "activate"; readonly entry: EntryRef}
    | {readonly id: string; readonly required?: boolean; readonly kind: "resolve"; readonly key: ServiceKey<unknown>}
    | {
          readonly id: string;
          readonly required?: boolean;
          readonly kind: "check";
          /** 检查需要读取的服务（例如根路径、数据库配置能力）；未声明的键在 check 内解析失败。 */
          readonly dependencies?: ReadonlyArray<ServiceDependency>;
          check(context: GateCheckContext): void | Promise<void>;
      };

/**
 * 机制诊断观察者：装配方在创建实例前提供，使启动初期的生命周期/装配/插件事件在任何诊断插件激活前
 * 就被记录（记录能力先于订阅存在）。回调异常由各机制吞掉，不改变机制状态。
 */
export interface MechanismObservers {
    readonly lifecycle?: LifecycleObserver;
    readonly services?: AssemblyObserver;
    readonly plugins?: PluginObserver;
}

/**
 * 静态受信清单由键登记表、本地能力、插件定义、启动必需插件与门禁组成。
 * 登记完成后并发激活选中的启动入口，再按门禁定义顺序执行；插件登记顺序没有语义。
 */
export interface ApplicationManifest {
    readonly keys: ReadonlyArray<ServiceKey<unknown>>;
    readonly capabilities?: ReadonlyArray<CapabilityProvider>;
    readonly plugins: ReadonlyArray<PluginDefinition>;
    /** 启动必需的插件；登记后并发激活它们在本位置的全部入口，失败则不开放接纳。 */
    readonly requiredPlugins?: ReadonlyArray<string>;
    readonly gates: ReadonlyArray<StartupGate>;
    readonly observers?: MechanismObservers;
}

export type GateOutcome =
    | {readonly id: string; readonly required: boolean; readonly status: "passed"}
    | {readonly id: string; readonly required: boolean; readonly status: "failed"; readonly reason: string; readonly error: FailureError | null}
    /** 停止先于门禁执行。 */
    | {readonly id: string; readonly required: boolean; readonly status: "skipped"};

export type StartupFailureCategory = "manifest" | "activation" | "gate" | "stopped";

/** 结构化启动失败：分类、来源与阶段是程序分支依据，人类文案不是。 */
export interface StartupFailure {
    readonly category: StartupFailureCategory;
    readonly required: boolean;
    /** 插件/入口、插件 id、能力 id 或门禁 id。 */
    readonly source: string;
    readonly stage: "register" | "activate" | "gate";
    /**
     * manifest 原因沿用 capability:<原因> / plugin:<登记拒绝原因>；缺失必需插件为 plugin:unknown-plugin。
     * activation 原因区分 blocked:<原因>、<失败阶段>/<原因>、rejected:<原因>、activate:threw 与 stopped/cancelled；
     * 清单拒绝与宿主停止导致的 stopped/cancelled 不额外记 activation 失败。
     */
    readonly reason: string;
    readonly error: FailureError | null;
}

export type StopResult =
    | {readonly status: "closed"}
    /** 清理失败、超时或被阻塞：保持停止中，不映射为 closed。 */
    | {readonly status: "incomplete"; readonly reason: CloseIncomplete["reason"]; readonly report: CloseIncomplete};

export type StartupResult =
    | {readonly status: "available"; readonly instanceId: string; readonly gates: ReadonlyArray<GateOutcome>; readonly failures: ReadonlyArray<StartupFailure>}
    /** 必需失败：不发布可用结果，已取得资源已收口（结果见 `stop`）。 */
    | {readonly status: "failed"; readonly instanceId: string; readonly gates: ReadonlyArray<GateOutcome>; readonly failures: ReadonlyArray<StartupFailure>; readonly stop: StopResult}
    /** 宿主在启动完成前要求停止。 */
    | {readonly status: "stopped"; readonly instanceId: string; readonly gates: ReadonlyArray<GateOutcome>; readonly failures: ReadonlyArray<StartupFailure>; readonly stop: StopResult};

export type AdmissionRejection = "startup-failed" | "stopping" | "closed";

export type AdmissionResult<T> =
    | {readonly status: "accepted"; readonly operation: OperationHandle<T>}
    | {readonly status: "rejected"; readonly reason: AdmissionRejection};

export interface ApplicationStatus {
    readonly identity: RuntimeInstanceIdentity;
    readonly phase: ScopePhase;
    /** 只有必需门禁全部成功且未停止时开放。 */
    readonly admission: "closed" | "open";
    readonly startup: StartupResult | null;
    readonly gates: ReadonlyArray<GateOutcome>;
    readonly failures: ReadonlyArray<StartupFailure>;
    readonly stop: StopResult | null;
}

export interface Application {
    readonly identity: RuntimeInstanceIdentity;
    /**
     * 根作用域：用于观察阶段、停止信号与创建子作用域（如 Project）。停止与恢复只经 `stop()` / `recover()`：
     * 直接关闭根作用域会绕过宿主截止、`stopped` 与 `closed` 通知。
     */
    readonly root: Scope;
    readonly assembly: ServiceAssembly;
    readonly plugins: PluginHost;
    /** 同一实例的全部启动请求共享它。 */
    readonly startup: Promise<StartupResult>;
    status(): ApplicationStatus;
    /** 等待同一启动结果后接纳业务操作；未开放接纳时明确拒绝，不绕过启动。 */
    admit<T>(spec: OperationSpec<T>): Promise<AdmissionResult<T>>;
    /** 幂等：重复停止观察同一次结果；宿主截止与调用方截止同时约束，任一触发即 `incomplete(deadline)`。 */
    stop(request?: CloseRequest): Promise<StopResult>;
    /**
     * 显式恢复：对上一次未完成的停止另起一次关闭尝试（只重试失败资源，不与在途清理重入）；
     * 只使用调用方自带的截止，不复用宿主为首次停止设的截止。之后 `stop()`、`status().stop`
     * 观察这次的结果。未进入停止时抛 LifecycleStateError。
     */
    recover(request?: CloseRequest): Promise<StopResult>;
    /** 本实例首次停止尝试的结算（无论由宿主信号、启动失败还是显式 stop 触发）；不触发停止。 */
    readonly stopped: Promise<StopResult>;
    /** 实例真正关闭（首次停止或之后某次恢复结算为 closed）时兑现；未完成的停止不兑现。适配器据此释放实例表条目。 */
    readonly closed: Promise<void>;
}
