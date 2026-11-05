/**
 * `nbook.canon` 对外的合同：世界服务的远程合同、浏览器侧的服务键、贡献点与预算（docs/specs/canon/project.md 的方法表、
 * 事件与输出 18）。
 *
 * - 世界的语义在 `@notnotype/nb-canon` 的 `WorldService`；远程合同只是把它的方法搬到链路上。读取结果与写入结果的形状
 *   由 nb-canon 的类型给出，链路上不再逐字段核对（`Type.Unknown()`）：提供方就是这份代码，输入才是要核对的边界。
 * - 业务失败都以一个业务失败码 `canon` 返回，详情是 nb-canon 的失败对象（`{code, ...}`）：失败码有几十个，其中
 *   `too-large` 等与路由层的码同名，不能逐个声明成业务失败码。
 */

import {defineRemoteService} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import {ActorSchema, AddressSchema, ObjectRefSchema, ReadPositionSchema, WriteRequestSchema} from "@notnotype/nb-canon/schema";
import type {DecisionView, EntryView, PendingItem, ReadPosition, Revision, StoryChange, Suggestion, WriteRequest} from "@notnotype/nb-canon/schema";
import {Type} from "typebox";
import type {Static} from "typebox";

import {RPC_MAX_MESSAGE_BYTES} from "nbook/shared/rpc-socket";

export {CANON_COMPONENTS_POINT} from "./components";
export type {ComponentContribution} from "./components";

/** 请求与读取结果经 JSON 编码后的上限：远程消息上限减 64 KiB，留给帧包络（输出 18）。 */
export const CANON_BUDGET_BYTES = RPC_MAX_MESSAGE_BYTES - 64 * 1024;

/** 经 JSON 编码后的 UTF-8 字节数；浏览器发出前、世界服务回结果前用同一个算法。 */
export function encodedBytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length;
}

const Mode = Type.Union([Type.Literal("actual"), Type.Literal("planned")]);
const Token = Type.Optional(Type.String());
const Cursor = Type.Optional(Type.String());
const Limit = Type.Optional(Type.Integer({minimum: 1, maximum: 500}));
const Read = Type.Object({value: Type.Unknown(), version: Type.Integer()});
const Out = Type.Unknown();

/** 失败的详情：nb-canon 的失败对象。 */
const FailureSchema = Type.Object({code: Type.String()});
const errors = {canon: FailureSchema};

const methods = {
    status: {input: Type.Object({}), output: Out, effect: "read", errors},
    entry: {input: Type.Object({id: Type.String(), position: ReadPositionSchema, mode: Mode, withOrigins: Type.Optional(Type.Boolean())}), output: Out, effect: "read", errors},
    tree: {input: Type.Object({parent: Type.Union([Type.String(), Type.Null()]), cursor: Cursor, limit: Limit}), output: Out, effect: "read", errors},
    lookup: {input: Type.Object({names: Type.Array(Type.String(), {maxItems: 200}), position: ReadPositionSchema}), output: Out, effect: "read", errors},
    changes: {
        input: Type.Object({
            filter: Type.Optional(Type.Object({
                chapter: Type.Optional(Type.String()),
                entry: Type.Optional(Type.String()),
                line: Type.Optional(Type.String()),
                kind: Type.Optional(Type.Union([Type.Literal("written"), Type.Literal("plan")])),
                status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("held"), Type.Literal("undone")])),
            }, {additionalProperties: false})),
            cursor: Cursor,
            limit: Limit,
        }),
        output: Out,
        effect: "read",
        errors,
    },
    object: {input: Type.Object({ref: ObjectRefSchema}), output: Out, effect: "read", errors},
    pending: {input: Type.Object({position: Type.Optional(ReadPositionSchema)}), output: Out, effect: "read", errors},
    decisions: {input: Type.Object({status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("decided"), Type.Literal("superseded"), Type.Literal("dropped")])), cursor: Cursor, limit: Limit}), output: Out, effect: "read", errors},
    suggestions: {input: Type.Object({status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("applied"), Type.Literal("declined")])), cursor: Cursor, limit: Limit}), output: Out, effect: "read", errors},
    revisions: {
        input: Type.Object({
            filter: Type.Optional(Type.Object({
                chapter: Type.Optional(Type.String()),
                entry: Type.Optional(Type.String()),
                by: Type.Optional(Type.Union([Type.Literal("author"), Type.Literal("agent"), Type.Literal("task"), Type.Literal("system")])),
            }, {additionalProperties: false})),
            cursor: Cursor,
            limit: Limit,
        }),
        output: Out,
        effect: "read",
        errors,
    },
    render: {input: Type.Object({entry: Type.String(), position: ReadPositionSchema, mode: Mode, audience: Type.Union([Type.Literal("author"), Type.Literal("agent")])}), output: Out, effect: "read", errors},
    preview: {input: Type.Object({request: WriteRequestSchema}), output: Out, effect: "read", errors},
    outcome: {input: Type.Object({requestId: Type.String()}), output: Out, effect: "read", errors},
    publish: {input: Type.Object({request: WriteRequestSchema, token: Token}), output: Out, effect: "write", errors},
    editInPlace: {
        input: Type.Object({
            requestId: Type.String({minLength: 1}),
            by: ActorSchema,
            position: ReadPositionSchema,
            at: AddressSchema,
            value: Type.Unknown(),
            read: Read,
            intent: Type.Optional(Type.Union([Type.Literal("creative"), Type.Literal("story")])),
            title: Type.Optional(Type.String()),
            token: Token,
        }),
        output: Out,
        effect: "write",
        errors,
    },
    recordDelta: {
        input: Type.Object({requestId: Type.String({minLength: 1}), by: ActorSchema, position: ReadPositionSchema, at: AddressSchema, delta: Type.Number(), reason: Type.String(), read: Read, token: Token}),
        output: Out,
        effect: "write",
        errors,
    },
    writeBack: {
        input: Type.Object({
            requestId: Type.String({minLength: 1}),
            by: ActorSchema,
            entry: Type.String(),
            block: Type.String(),
            position: ReadPositionSchema,
            version: Type.Integer(),
            mode: Mode,
            text: Type.String(),
            intent: Type.Optional(Type.Union([Type.Literal("creative"), Type.Literal("story")])),
            title: Type.Optional(Type.String()),
            token: Token,
        }),
        output: Out,
        effect: "write",
        errors,
    },
    revert: {input: Type.Object({revision: Type.String(), withDependents: Type.Boolean(), requestId: Type.String({minLength: 1}), by: ActorSchema, title: Type.Optional(Type.String()), token: Token}), output: Out, effect: "write", errors},
    acquireExclusive: {input: Type.Object({label: Type.String({minLength: 1})}), output: Out, effect: "write", errors},
    renewExclusive: {input: Type.Object({token: Type.String()}), output: Out, effect: "write", errors},
    releaseExclusive: {input: Type.Object({token: Type.String()}), output: Type.Null(), effect: "write", errors},
    breakExclusive: {input: Type.Object({}), output: Type.Null(), effect: "write", errors},
} as const;

const events = {
    changed: {filter: Type.Object({}), payload: Out},
    exclusive: {filter: Type.Object({}), payload: Type.Object({holder: Type.Union([Type.String(), Type.Null()])})},
    reduced: {filter: Type.Object({}), payload: Type.Object({})},
    /**
     * 独占的租约订阅（输出 10）：申请到令牌的调用方订阅它；订阅结束（连接断开、调用方实例失效、退订）即结束独占。
     * 推一次 `held`，独占结束时推 `ended`。
     */
    lease: {filter: Type.Object({token: Type.String()}), payload: Type.Object({state: Type.Union([Type.Literal("held"), Type.Literal("ended")])})},
} as const;

/** 项目实例提供；浏览器、TUI 与服务端都能调。 */
export const canonWorldContract = defineRemoteService({id: "nbook.canon/world", version: 1, provider: "project", callers: ["browser", "tui", "server"], methods, events});

export type CanonMethod = keyof typeof methods;
export type CanonInput<M extends CanonMethod> = Static<(typeof methods)[M]["input"]>;

/** nb-canon 的失败对象，或链路上的失败（`code` 是路由层的失败码，`detail` 是说明）。 */
export interface CanonFailure {
    readonly code: string;
    readonly [detail: string]: unknown;
}

export type CanonResult<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly failure: CanonFailure};

/** 写入成功的结果（输出：`publish`）。 */
export interface Published {
    readonly revision: string;
    readonly version: number;
    readonly ids: Readonly<Record<string, string>>;
    readonly repeated: boolean;
    /** 就地改与记一笔：之后的记录里还有同一地址的改动（revisions.md 输出 8）。 */
    readonly laterRecords?: readonly string[];
}

export interface CanonStatus {
    readonly version: number;
    readonly state: "writable" | "read-only" | "stopped";
    readonly reason?: string;
    readonly exclusive: {readonly label: string; readonly since: number} | null;
    readonly diagnostics: readonly unknown[];
    readonly recomputed: unknown;
}

export interface Page<T> {
    readonly version: number;
    readonly items: readonly T[];
    readonly cursor?: string;
}

/** 各方法成功时的值；形状与 nb-canon 的 `WorldService` 相同，只是写入结果去掉了内存里的世界。 */
export interface CanonOutputs {
    readonly status: CanonStatus;
    readonly entry: {readonly version: number; readonly view: EntryView | null; readonly origins?: Readonly<Record<string, unknown>>};
    readonly tree: Page<{readonly id: string; readonly name: string; readonly type: string; readonly folder: string; readonly deleted: boolean; readonly hasChildren: boolean}>;
    readonly lookup: {readonly version: number; readonly found: Readonly<Record<string, readonly string[]>>};
    readonly changes: Page<{readonly change: StoryChange; readonly outcome: unknown}>;
    readonly pending: {readonly version: number; readonly items: readonly PendingItem[]};
    readonly decisions: Page<DecisionView>;
    readonly suggestions: Page<Suggestion>;
    readonly revisions: Page<{readonly id: string; readonly version: number; readonly by: Revision["by"]; readonly what: string; readonly title: string; readonly time: string; readonly chapter?: string; readonly impact: Revision["impact"]; readonly revertable: {readonly ok: boolean; readonly reason?: string; readonly dependents?: readonly string[]}}>;
    readonly render: {readonly version: number; readonly position: ReadPosition; readonly mode: "actual" | "planned"; readonly blocks: readonly unknown[]} | null;
    /** 存下来的对象；不存在时 `object` 为 null。 */
    readonly object: {readonly version: number; readonly object: unknown};
    readonly preview: {readonly revision: Revision; readonly ids: Readonly<Record<string, string>>};
    readonly outcome: {readonly published: true; readonly revision: string; readonly version: number} | {readonly published: false};
    readonly publish: Published;
    readonly editInPlace: Published;
    readonly recordDelta: Published;
    readonly writeBack: Published;
    readonly revert: Published;
    readonly acquireExclusive: {readonly token: string; readonly expires: number};
    readonly renewExclusive: {readonly expires: number};
    readonly releaseExclusive: null;
    readonly breakExclusive: null;
}

export type CanonEvent =
    | {readonly kind: "changed"; readonly version: number; readonly revision: string; readonly by: Revision["by"]; readonly what: string; readonly title: string}
    | {readonly kind: "exclusive"; readonly holder: string | null}
    | {readonly kind: "reduced"}
    /** 同一项目代次内重连后订阅已重建：中间可能漏了事件，先读一次 `status` 拿当前版本再重读（Spec project“时序与寿命”）。 */
    | {readonly kind: "resync"}
    /** 订阅被提供方结束（项目实例停止、链路关闭）；之后不再有事件。调用方自己 `release` 时不发。 */
    | {readonly kind: "ended"; readonly reason: string};

/** 持有中的独占写入（`hold` 的结果）。 */
export interface CanonLease {
    readonly token: string;
    /** 申请时的到期时间（毫秒时间戳）；带令牌的写入与 `renew` 都把它往后推 60 秒。 */
    readonly expires: number;
    renew(): Promise<CanonResult<{readonly expires: number}>>;
    /** 退订租约并释放独占。 */
    release(): Promise<CanonResult<null>>;
}

/**
 * 浏览器入口按调用方提供的世界客户端。请求超过预算时不发出，直接得到 `too-large`（输出 18）。
 * `hold` 申请独占并持有租约订阅：独占结束（释放、到期、被强行解除、订阅被提供方结束）时调一次 `onEnded`；
 * 连接断开时独占随订阅结束。经 `call("acquireExclusive")` 申请的独占没有租约订阅，只靠 60 秒到期结束。
 */
export interface CanonClient {
    call<M extends CanonMethod>(method: M, input: CanonInput<M>): Promise<CanonResult<CanonOutputs[M]>>;
    publish(request: WriteRequest, token?: string): Promise<CanonResult<Published>>;
    subscribe(listener: (event: CanonEvent) => void): Promise<CanonResult<{release(): void}>>;
    hold(label: string, onEnded?: (reason: string) => void): Promise<CanonResult<CanonLease>>;
}

export const canonClientKey: ServiceKey<CanonClient> = defineServiceKey<CanonClient>("nbook.canon/client");
