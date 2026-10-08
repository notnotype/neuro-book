/**
 * 远程服务的 wire 协议：帧格式、请求阶段与失败码、保留字段。纯模块，不做 I/O。
 *
 * 帧是内核内部协议：调用方身份（`$nbConsumer`）与激活链（`$nbChain`）只由内核填写，和业务参数
 * （`input`、`filter`）分开传；业务参数里出现 `$nb` 开头的键一律拒绝，避免同名字段被误当成身份。
 * 行为合同见 docs/specs/runtime/plugin-channel.md。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";
import type {TSchema} from "typebox";

/**
 * 握手时核对；不兼容时在处理任何业务帧前拒绝链路。帧格式变化时提升（2：握手加入项目绑定；3：调用方身份
 * 加入客户端身份）。`hello` 的
 * `wire` 字段与 `reject` 帧的形状跨版本不变：任何版本的客户端都能让服务端读出版本、读懂服务端的拒绝。
 */
export const WIRE_PROTOCOL_VERSION = 3;

/** 路由层失败码，对所有远程服务相同；业务失败码由各合同声明。 */
export const REMOTE_FAILURE_CODES = [
    "invalid-input",
    "denied",
    "target-gone",
    "unavailable",
    "version-changed",
    "timeout",
    "cancelled",
    "unknown-outcome",
    "provider-error",
] as const;

export type RemoteFailureCode = (typeof REMOTE_FAILURE_CODES)[number];

/** 请求中断的原因；`activation-cycle` 只出现在按需激活形成等待环时。 */
export type RemoteCause = "target-gone" | "timeout" | "cancelled" | "disconnected" | "activation-cycle";

export interface RemoteFailure<Code extends string = RemoteFailureCode> {
    readonly ok: false;
    readonly code: Code;
    readonly cause?: RemoteCause;
    /** 业务失败的详情（按合同 `errors` 里的 schema），或路由层失败的说明。 */
    readonly detail?: unknown;
}

export type RemoteResult<T, BusinessCode extends string = never> = {readonly ok: true; readonly value: T} | RemoteFailure<RemoteFailureCode | BusinessCode>;

/**
 * 请求被中断时所处的阶段（runtime/plugin-channel.md 输出第 4 条）：
 * - `undispatched`：帧还没交给链路，目标不可能收到；
 * - `sent`：帧已交给链路，还没收到 ACK。目标可能已经 ACK 并开始执行，只是 ACK 在链路中断时丢在了路上；
 * - `acked`：目标已 ACK，正在执行。
 */
export type RequestPhase = "undispatched" | "sent" | "acked";

/**
 * 中断时的结果：帧还没发出时都是确定失败。帧发出之后，写请求一律 `unknown-outcome` 并附原因，因为收到
 * ACK 证明不了副作用没发生、没收到 ACK 也证明不了没执行；读请求按原因报告、可以重试，断开时以是否收到
 * ACK 区分 `unavailable` 与 `target-gone`。
 */
export function failureFor(phase: RequestPhase, effect: "read" | "write", cause: RemoteCause): RemoteFailure {
    if (phase !== "undispatched" && effect === "write") {
        return {ok: false, code: "unknown-outcome", cause};
    }
    switch (cause) {
        case "target-gone":
            return {ok: false, code: "target-gone", cause};
        case "timeout":
            return {ok: false, code: "timeout", cause};
        case "cancelled":
            return {ok: false, code: "cancelled", cause};
        case "disconnected":
            return {ok: false, code: phase === "acked" ? "target-gone" : "unavailable", cause};
        case "activation-cycle":
            return {ok: false, code: "unavailable", cause};
    }
}

/** 业务参数不得含 `$nb` 开头的键：这些名字留给内核填写的帧字段。 */
export const RESERVED_KEY_PREFIX = "$nb";

export function reservedKeys(value: unknown): string[] {
    if (typeof value !== "object" || value === null) {
        return [];
    }
    return Object.keys(value).filter((key) => key.startsWith(RESERVED_KEY_PREFIX));
}

/** 按 schema 校验；通过返回 null，否则返回脱敏的错误摘要（路径与说明，不含值）。 */
export function validationProblems(schema: TSchema, value: unknown): string | null {
    if (Value.Check(schema, value)) {
        return null;
    }
    return [...Value.Errors(schema, value)]
        .slice(0, 5)
        .map((error) => `${error.instancePath === "" ? "/" : error.instancePath}：${error.message}`)
        .join("；");
}

const NullableString = Type.Union([Type.String(), Type.Null()]);
const NullableInteger = Type.Union([Type.Integer(), Type.Null()]);

/**
 * 帧上的调用方身份；与 runtime.services 的 ConsumerIdentity 同形。`location` 与 `client` 属于实例描述，
 * 路由按发来链路登记的成员描述覆盖（runtime/plugin-channel.md 输出第 3 条）。
 */
export const CallerFrameSchema = Type.Object({
    instanceId: Type.String({minLength: 1}),
    location: Type.String({minLength: 1}),
    client: NullableString,
    plugin: NullableString,
    entry: NullableString,
    generation: NullableInteger,
    via: Type.Union([Type.Object({plugin: Type.String(), entry: Type.String(), generation: NullableInteger}, {additionalProperties: false}), Type.Null()]),
}, {additionalProperties: false});

export type CallerFrame = Static<typeof CallerFrameSchema>;

/**
 * 租约持有者的编码：实例 + 插件 + 入口 + 入口激活代次。委托代理（`via`）不参与：租约记在发起它的入口这次
 * 激活名下，经不经代理都按它核对。宿主取得租约与路由核对 `{project}` 访问都用这一个函数，插件冒用不了别人的租约。
 */
export function leaseHolderOf(caller: Pick<CallerFrame, "instanceId" | "plugin" | "entry" | "generation">): string {
    return JSON.stringify([caller.instanceId, caller.plugin, caller.entry, caller.generation]);
}

const EntryRefSchema = Type.Object({instanceId: Type.String(), plugin: Type.String(), entry: Type.String()}, {additionalProperties: false});

/** 激活链上的一环：哪个实例里的哪个入口正在因远程调用而激活。 */
export type ChainLink = Static<typeof EntryRefSchema>;

export const TargetSchema = Type.Union([
    Type.Literal("project"),
    Type.Literal("server"),
    Type.Object({project: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({client: Type.String({minLength: 1})}, {additionalProperties: false}),
]);

export type RemoteTarget = Static<typeof TargetSchema>;

const ProjectGenerationSchema = Type.Object({id: Type.String({minLength: 1}), generation: Type.Integer()}, {additionalProperties: false});

/**
 * 实例描述。`kind` 是运行位置（宿主声明）；`role` 是它在拓扑里的位置：`hub` 是运行路由的服务端实例，
 * `project` 是项目实例，`client` 是客户端。`project` 是本实例绑定（项目实例则是自身）的项目代次。
 * `client` 是客户端身份：跨重新加载稳定，区别于每次启动都换新的 `id`；服务端与项目实例为 null。
 */
export const InstanceSchema = Type.Object({
    id: Type.String({minLength: 1}),
    kind: Type.String({minLength: 1}),
    role: Type.Union([Type.Literal("hub"), Type.Literal("project"), Type.Literal("client")]),
    project: Type.Union([ProjectGenerationSchema, Type.Null()]),
    client: Type.Union([Type.String({minLength: 1}), Type.Null()]),
}, {additionalProperties: false});

export type InstanceDescriptor = Static<typeof InstanceSchema>;

/**
 * 客户端的绑定请求：首次连接按项目引用（短名或 id），重连带已绑定的 id 与代次；不绑定为 null。
 * 只有客户端可以带，服务端由宿主决定绑定（runtime/plugin-channel.md 的“WebSocket 传输与握手”第 3 条）。
 */
export const BindRequestSchema = Type.Union([
    Type.Null(),
    Type.Object({project: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({project: Type.String({minLength: 1}), generation: Type.Integer()}, {additionalProperties: false}),
]);

export type BindRequest = Static<typeof BindRequestSchema>;

/** 握手回复的绑定结果：客户端绑定的项目代次与短名。 */
export const ProjectBindingSchema = Type.Object({id: Type.String({minLength: 1}), name: Type.String({minLength: 1}), generation: Type.Integer()}, {additionalProperties: false});

export type ProjectBinding = Static<typeof ProjectBindingSchema>;

const OutcomeSchema = Type.Union([
    Type.Object({ok: Type.Literal(true), value: Type.Unknown()}, {additionalProperties: false}),
    Type.Object({
        ok: Type.Literal(false),
        code: Type.String({minLength: 1}),
        cause: Type.Optional(Type.Union([Type.Literal("target-gone"), Type.Literal("timeout"), Type.Literal("cancelled"), Type.Literal("disconnected"), Type.Literal("activation-cycle")])),
        detail: Type.Optional(Type.Unknown()),
    }, {additionalProperties: false}),
]);

const Id = Type.String({minLength: 1});

export const FrameSchema = Type.Union([
    /**
     * `boot` 是客户端上次握手得到的服务端进程标识（第一次为 null）。路由先比它：服务端换了进程就直接拒绝，
     * 不让新进程按旧进程的项目代次号去判断绑定（代次号在新进程里从头编号，可能撞上）。
     */
    Type.Object({type: Type.Literal("hello"), wire: Type.Integer(), instance: InstanceSchema, bind: BindRequestSchema, boot: Type.Union([Type.String({minLength: 1}), Type.Null()])}, {additionalProperties: false}),
    /** `boot` 是服务端这一次进程的标识：客户端重连时据此区分“同一进程”与“服务端已重启”。 */
    Type.Object({type: Type.Literal("welcome"), wire: Type.Integer(), boot: Type.String({minLength: 1}), binding: Type.Union([ProjectBindingSchema, Type.Null()])}, {additionalProperties: false}),
    Type.Object({type: Type.Literal("reject"), reason: Type.String(), message: Type.String()}, {additionalProperties: false}),
    Type.Object({
        type: Type.Literal("request"),
        id: Id,
        target: TargetSchema,
        contract: Type.String({minLength: 1}),
        version: Type.Integer({minimum: 1}),
        method: Type.String({minLength: 1}),
        /** 调用方按自己的合同填写；路由与调用方据此计算中断后的失败码。 */
        effect: Type.Union([Type.Literal("read"), Type.Literal("write")]),
        input: Type.Unknown(),
        $nbConsumer: CallerFrameSchema,
        $nbChain: Type.Array(EntryRefSchema),
    }, {additionalProperties: false}),
    Type.Object({type: Type.Literal("ack"), id: Id}, {additionalProperties: false}),
    Type.Object({type: Type.Literal("result"), id: Id, outcome: OutcomeSchema}, {additionalProperties: false}),
    Type.Object({type: Type.Literal("cancel"), id: Id}, {additionalProperties: false}),
    Type.Object({
        type: Type.Literal("subscribe"),
        id: Id,
        target: TargetSchema,
        contract: Type.String({minLength: 1}),
        version: Type.Integer({minimum: 1}),
        event: Type.String({minLength: 1}),
        filter: Type.Unknown(),
        $nbConsumer: CallerFrameSchema,
        $nbChain: Type.Array(EntryRefSchema),
    }, {additionalProperties: false}),
    Type.Object({type: Type.Literal("event"), id: Id, payload: Type.Unknown()}, {additionalProperties: false}),
    Type.Object({type: Type.Literal("unsubscribe"), id: Id}, {additionalProperties: false}),
    Type.Object({type: Type.Literal("subscription-ended"), id: Id, reason: Type.String()}, {additionalProperties: false}),
    /** 调用方入口的这次激活结束：目标实例释放为它生成的门面。不需要回复。 */
    Type.Object({type: Type.Literal("release"), target: TargetSchema, $nbConsumer: CallerFrameSchema}, {additionalProperties: false}),
]);

export type Frame = Static<typeof FrameSchema>;
export type RequestFrame = Extract<Frame, {type: "request"}>;
export type SubscribeFrame = Extract<Frame, {type: "subscribe"}>;
export type ReleaseFrame = Extract<Frame, {type: "release"}>;
export type HelloFrame = Extract<Frame, {type: "hello"}>;
export type RejectFrame = Extract<Frame, {type: "reject"}>;
export type Outcome = Extract<Frame, {type: "result"}>["outcome"];

/** 链路上收到的值先经这里：结构不对的帧丢弃（调用方记诊断），不进入路由。 */
export function parseFrame(value: unknown): Frame | null {
    return Value.Check(FrameSchema, value) ? value : null;
}

/**
 * 握手第一步只看 wire 版本，在结构校验之前：另一版本的 hello 可能是另一种形状，按本版本的 schema 会被
 * 当成无效帧丢掉，对端只能等到超时。返回版本不符时要发的拒绝帧；不是 hello、`wire` 不是整数或版本相同
 * 时返回 null，交给正常的帧解析。
 */
export function wireMismatch(value: unknown): RejectFrame | null {
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const {type, wire} = value as {readonly type?: unknown; readonly wire?: unknown};
    if (type !== "hello" || typeof wire !== "number" || !Number.isInteger(wire) || wire === WIRE_PROTOCOL_VERSION) {
        return null;
    }
    return {type: "reject", reason: "wire-version", message: `wire 协议版本 ${String(wire)} 与本端 ${String(WIRE_PROTOCOL_VERSION)} 不兼容`};
}
