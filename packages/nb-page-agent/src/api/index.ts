/**
 * 页面里的参数、返回与失败（docs/specs/agent/page-agent.md 输出 3 到 5、12）：只有一个页面里的概念，不碰 DOM，前后端都能引用。
 * 宿主在这上面扩展自己的东西（NeuroBook 加界面目录、窗口类失败码与按命令定位），生成给模型看的工具参数与文档。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

/** 引擎自己的节点（描边框、说明框）都带这个属性；快照、命中检查与定位都跳过它们。 */
export const OWN_NODE_ATTRIBUTE = "data-nb-page-agent";
/** 宿主标出的不列内容的区域（`data-nb-agent="skip"`）。 */
export const SKIP_ATTRIBUTE = "data-nb-agent";
export const SKIP_VALUE = "skip";
/** 控件的稳定名（`./attrs` 的 `nbTarget` 写的）。 */
export const TARGET_ATTRIBUTE = "data-nb-target";
export const KEY_ATTRIBUTE = "data-nb-key";

const BaseLocatorProperties = {
    ref: Type.Optional(Type.String({minLength: 1, maxLength: 64, description: "快照给的引用，形如 a3.12"})),
    target: Type.Optional(Type.String({minLength: 1, maxLength: 128, description: "稳定名，例如 settings.row"})),
    key: Type.Optional(Type.String({minLength: 1, maxLength: 256, description: "稳定名的 key：同名控件里的业务身份，与 target 一起用"})),
    role: Type.Optional(Type.String({minLength: 1, maxLength: 64, description: "角色，例如 button、treeitem；与 name 一起用"})),
    name: Type.Optional(Type.String({maxLength: 512, description: "可访问名，与 role 一起用"})),
    text: Type.Optional(Type.String({minLength: 1, maxLength: 512, description: "看得见的文字；其它写法都不行时才用"})),
    exact: Type.Optional(Type.Boolean({description: "名字与文字精确匹配；缺省不分大小写、折叠空白的子串匹配"})),
    nth: Type.Optional(Type.Integer({minimum: 0, maximum: 999, description: "命中多个时取第几个，从 0 起"})),
};

/** `within` 里的定位：同一套写法，不能再套 `within`。 */
export const BaseLocatorSchema = Type.Object(BaseLocatorProperties, {additionalProperties: false});

/** 定位（输出 5）：恰好给一种主定位（`ref`；`target` 加可选 `key`；`role` 加 `name`；`text`），可另给 `exact`、`nth`、`within`。 */
export const LocatorSchema = Type.Object({
    ...BaseLocatorProperties,
    within: Type.Optional(Type.Object(BaseLocatorProperties, {additionalProperties: false, description: "只在这个元素里找"})),
}, {additionalProperties: false});

export type BaseLocator = Static<typeof BaseLocatorSchema>;
export type Locator = Static<typeof LocatorSchema>;

/** 主定位的种类；`locatorKind` 校验“恰好一种”。 */
export type LocatorKind = "ref" | "target" | "role" | "text";

/** 校验恰好给了一种主定位：交回种类，或说明哪里不对（这类错是调用方写错了参数，宿主报成参数错误）。 */
export function locatorKind(locator: BaseLocator): {readonly ok: true; readonly kind: LocatorKind} | {readonly ok: false; readonly message: string} {
    const given: LocatorKind[] = [];
    if (locator.ref !== undefined) given.push("ref");
    if (locator.target !== undefined) given.push("target");
    if (locator.role !== undefined) given.push("role");
    if (locator.text !== undefined) given.push("text");
    if (given.length !== 1) return {ok: false, message: given.length === 0 ? "定位要给 ref、target、role 或 text 中的一种" : `定位只能给一种主定位，收到 ${given.join("、")}`};
    if (locator.key !== undefined && locator.target === undefined) return {ok: false, message: "key 要与 target 一起用"};
    if (locator.name !== undefined && locator.role === undefined) return {ok: false, message: "name 要与 role 一起用"};
    return {ok: true, kind: given[0]!};
}

export const SNAPSHOT_DEFAULT_TOKENS = 3000;
export const SNAPSHOT_MAX_TOKENS = 8000;

export const SnapshotArgsSchema = Type.Object({
    scope: Type.Optional(LocatorSchema),
    includeText: Type.Optional(Type.Boolean({description: "另列标题、段落与状态提示里的文字"})),
    maxTokens: Type.Optional(Type.Integer({minimum: 200, maximum: SNAPSHOT_MAX_TOKENS, description: `快照的大小上限（估算的 token），缺省 ${String(SNAPSHOT_DEFAULT_TOKENS)}`})),
}, {additionalProperties: false});

export type SnapshotArgs = Static<typeof SnapshotArgsSchema>;

/** 快照里的一个元素；`text` 里的一行对应一个。 */
export const SnapshotElementSchema = Type.Object({
    ref: Type.String(),
    role: Type.String(),
    name: Type.String(),
    target: Type.Optional(Type.String()),
    key: Type.Optional(Type.String()),
    /** 所在的层：`base` 或层根的引用。 */
    layer: Type.String(),
    states: Type.Array(Type.String()),
    value: Type.Optional(Type.String()),
}, {additionalProperties: false});

export type SnapshotElement = Static<typeof SnapshotElementSchema>;

export const SnapshotResultSchema = Type.Object({
    /** 文本树：表头（窗口、层）加一行一个元素，按层级缩进。 */
    text: Type.String({maxLength: 65536}),
    elements: Type.Array(SnapshotElementSchema, {maxItems: 500}),
    truncated: Type.Boolean(),
    warnings: Type.Array(Type.String({maxLength: 1024}), {maxItems: 50}),
}, {additionalProperties: false});

export type SnapshotResult = Static<typeof SnapshotResultSchema>;

/** 页面里的失败码（输出 4、5）；窗口类的码由宿主加。 */
export type PageFailureCode = "stale-ref" | "ambiguous" | "not-found";

/** 失败时给调用方挑的候选：带新的引用，可以直接拿来再定位。 */
export const CandidateSchema = Type.Object({
    ref: Type.String(),
    role: Type.String(),
    name: Type.String(),
    target: Type.Optional(Type.String()),
    key: Type.Optional(Type.String()),
}, {additionalProperties: false});

export type Candidate = Static<typeof CandidateSchema>;

export const PageFailureDetailsSchema = Type.Object({
    candidates: Type.Optional(Type.Array(CandidateSchema, {maxItems: 10})),
}, {additionalProperties: false});

export type PageFailureDetails = Static<typeof PageFailureDetailsSchema>;

export interface PageFailure {
    readonly ok: false;
    readonly code: PageFailureCode;
    readonly message: string;
    readonly details?: PageFailureDetails;
}

/** 回复里文字、`details` 与整个回复的大小上限（输出 12），按 UTF-8 字节量。 */
export const TEXT_BYTE_LIMIT = 64 * 1024;
export const DETAILS_BYTE_LIMIT = 8 * 1024;
export const ELEMENT_LIMIT = 500;
/** 每个回复按 JSON 序列化后的上限：宿主 WebSocket 的单条消息上限是 1 MiB，留出信封与别的字段的余量。 */
export const RESULT_BYTE_LIMIT = 256 * 1024;
