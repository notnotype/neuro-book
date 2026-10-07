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

/** 握手时核对；不兼容时在处理任何业务帧前拒绝链路。帧格式变化时提升。 */
export const WIRE_PROTOCOL_VERSION = 1;

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

/** 已派发请求中断的原因；`activation-cycle` 只出现在按需激活形成等待环时。 */
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
 * 请求在哪个阶段失败决定结果：未派发前的失败都是确定的；已派发（目标已 ACK）后，读请求按原因
 * 报告、可以重试，写请求一律 `unknown-outcome` 并附原因，因为 ACK 证明不了副作用没发生。
 */
export function failureFor(phase: "undispatched" | "dispatched", effect: "read" | "write", cause: RemoteCause): RemoteFailure {
    if (phase === "dispatched" && effect === "write") {
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
            return {ok: false, code: phase === "undispatched" ? "unavailable" : "target-gone", cause};
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

/** 帧上的调用方身份；与 runtime.services 的 ConsumerIdentity 同形。 */
export const CallerFrameSchema = Type.Object({
    instanceId: Type.String({minLength: 1}),
    location: Type.String({minLength: 1}),
    plugin: NullableString,
    entry: NullableString,
    generation: NullableInteger,
    via: Type.Union([Type.Object({plugin: Type.String(), entry: Type.String(), generation: NullableInteger}, {additionalProperties: false}), Type.Null()]),
}, {additionalProperties: false});

export type CallerFrame = Static<typeof CallerFrameSchema>;

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

const ProjectBindingSchema = Type.Object({id: Type.String({minLength: 1}), generation: Type.Integer()}, {additionalProperties: false});

/**
 * 实例描述。`kind` 是运行位置（宿主声明）；`role` 是它在拓扑里的位置：`hub` 是运行路由的服务端实例，
 * `project` 是项目实例，`client` 是客户端。`project` 是本实例绑定（项目实例则是自身）的项目代次。
 */
export const InstanceSchema = Type.Object({
    id: Type.String({minLength: 1}),
    kind: Type.String({minLength: 1}),
    role: Type.Union([Type.Literal("hub"), Type.Literal("project"), Type.Literal("client")]),
    project: Type.Union([ProjectBindingSchema, Type.Null()]),
}, {additionalProperties: false});

export type InstanceDescriptor = Static<typeof InstanceSchema>;

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
    Type.Object({type: Type.Literal("hello"), wire: Type.Integer(), instance: InstanceSchema}, {additionalProperties: false}),
    Type.Object({type: Type.Literal("welcome"), wire: Type.Integer()}, {additionalProperties: false}),
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
    Type.Object({type: Type.Literal("resync"), id: Id}, {additionalProperties: false}),
    /** 调用方入口的这次激活结束：目标实例释放为它生成的门面。不需要回复。 */
    Type.Object({type: Type.Literal("release"), target: TargetSchema, $nbConsumer: CallerFrameSchema}, {additionalProperties: false}),
]);

export type Frame = Static<typeof FrameSchema>;
export type RequestFrame = Extract<Frame, {type: "request"}>;
export type SubscribeFrame = Extract<Frame, {type: "subscribe"}>;
export type ReleaseFrame = Extract<Frame, {type: "release"}>;
export type HelloFrame = Extract<Frame, {type: "hello"}>;
export type Outcome = Extract<Frame, {type: "result"}>["outcome"];

/** 链路上收到的值先经这里：结构不对的帧丢弃（调用方记诊断），不进入路由。 */
export function parseFrame(value: unknown): Frame | null {
    return Value.Check(FrameSchema, value) ? value : null;
}

/** 握手核对：只看 wire 协议版本。 */
export function checkHello(frame: HelloFrame): {readonly ok: true} | {readonly ok: false; readonly reason: "wire-version"; readonly message: string} {
    if (frame.wire !== WIRE_PROTOCOL_VERSION) {
        return {ok: false, reason: "wire-version", message: `wire 协议版本 ${String(frame.wire)} 与本端 ${String(WIRE_PROTOCOL_VERSION)} 不兼容`};
    }
    return {ok: true};
}
