/**
 * `nbook.page-agent` 的公开合同（docs/specs/agent/page-agent.md）：eval 全局对象 `ui` 的方法 id、参数与返回的 schema，
 * 以及服务端调窗口的远程合同。页面里的概念（定位、快照、页面失败）来自核心包 `@notnotype/nb-page-agent/api`，这里只加
 * NeuroBook 的东西：按命令定位、界面目录、窗口与截图。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {BaseLocatorSchema, CandidateSchema, HighlightArgsSchema, HighlightInstalledSchema, LocatorSchema, PageOutcomeSchema, SnapshotArgsSchema, SnapshotResultSchema} from "@notnotype/nb-page-agent/api";
import type {BaseLocator, Locator} from "@notnotype/nb-page-agent/api";
import {defineRemoteService} from "@notnotype/nb-runtime/remote";

export const PAGE_AGENT_PLUGIN = "nbook.page-agent";
/** 代码里的全局名。 */
export const UI_OBJECT = "ui";
export const SNAPSHOT_TOOL = `${PAGE_AGENT_PLUGIN}.snapshot` as const;
export const FIND_TOOL = `${PAGE_AGENT_PLUGIN}.find` as const;
export const SCREENSHOT_TOOL = `${PAGE_AGENT_PLUGIN}.screenshot` as const;
export const HIGHLIGHT_TOOL = `${PAGE_AGENT_PLUGIN}.highlight` as const;

/** 视图与编辑区标题栏上的命令按钮的稳定名（输出 6）：`{command: id}` 是 `{target: "command", key: id}` 的简写。 */
export const COMMAND_TARGET = "command";

// ---------- 定位：核心的写法加 `command` ----------

const CommandProperty = {
    command: Type.Optional(Type.String({minLength: 1, maxLength: 256, description: "命令 id：标题栏上画成按钮的那个命令，等同 {target: \"command\", key: <命令 id>}"})),
};

export const UiBaseLocatorSchema = Type.Object({...BaseLocatorSchema.properties, ...CommandProperty}, {additionalProperties: false});
export const UiLocatorSchema = Type.Object({
    ...BaseLocatorSchema.properties,
    ...CommandProperty,
    within: Type.Optional(Type.Object({...BaseLocatorSchema.properties, ...CommandProperty}, {additionalProperties: false, description: "只在这个元素里找"})),
}, {additionalProperties: false, description: "定位：恰好给 ref；target（加可选 key）；command；role（加可选 name）；text 中的一种"});

export type UiBaseLocator = Static<typeof UiBaseLocatorSchema>;
export type UiLocator = Static<typeof UiLocatorSchema>;

function pageBase(locator: UiBaseLocator): {readonly ok: true; readonly locator: BaseLocator} | {readonly ok: false; readonly message: string} {
    const {command, ...rest} = locator;
    if (command === undefined) return {ok: true, locator: rest};
    if (rest.ref !== undefined || rest.target !== undefined || rest.role !== undefined || rest.text !== undefined) return {ok: false, message: "command 不能与 ref、target、role、text 一起给"};
    if (rest.key !== undefined) return {ok: false, message: "command 不能与 key 一起给：命令 id 就是 key"};
    return {ok: true, locator: {...rest, target: COMMAND_TARGET, key: command}};
}

/** 把 `command` 换成稳定名，交给页面引擎；其余写错的地方由引擎的 `locatorKind` 报。 */
export function toPageLocator(locator: UiLocator): {readonly ok: true; readonly locator: Locator} | {readonly ok: false; readonly message: string} {
    const {within, ...base} = locator;
    const main = pageBase(base);
    if (!main.ok) return main;
    if (within === undefined) return main;
    const inner = pageBase(within);
    if (!inner.ok) return {ok: false, message: `within：${inner.message}`};
    return {ok: true, locator: {...main.locator, within: inner.locator}};
}

// ---------- 方法的参数 ----------

export const UiSnapshotArgsSchema = Type.Object({
    ...SnapshotArgsSchema.properties,
    scope: Type.Optional(UiLocatorSchema),
}, {additionalProperties: false});

export const FIND_DEFAULT_LIMIT = 5;
export const FIND_MAX_LIMIT = 20;
export const FIND_KINDS = ["setting", "section", "view", "command"] as const;
export type FindKind = (typeof FIND_KINDS)[number];
const FindKindSchema = Type.Union([Type.Literal("setting"), Type.Literal("section"), Type.Literal("view"), Type.Literal("command")]);

export const UiFindArgsSchema = Type.Object({
    query: Type.String({minLength: 1, maxLength: 200, description: "要找的东西，例如“主题”“会话”；中英文都行，与命令面板的搜索相同"}),
    kind: Type.Optional(Type.Union([Type.Literal("setting"), Type.Literal("section"), Type.Literal("view"), Type.Literal("command")], {description: "只找一种：setting 设置项、section 设置窗口的一节、view 视图、command 命令"})),
    limit: Type.Optional(Type.Integer({minimum: 1, maximum: FIND_MAX_LIMIT, description: `至多交回几条，缺省 ${String(FIND_DEFAULT_LIMIT)}`})),
}, {additionalProperties: false});

export const UiScreenshotArgsSchema = Type.Object({
    of: Type.Optional(UiLocatorSchema),
}, {additionalProperties: false});

/** 等用户的上限（秒，输入与前置条件的表）。 */
export const HIGHLIGHT_DEFAULT_TIMEOUT_S = 300;
export const HIGHLIGHT_MAX_TIMEOUT_S = 3600;

export const UiHighlightArgsSchema = Type.Object({
    ...HighlightArgsSchema.properties,
    at: UiLocatorSchema,
    timeout: Type.Optional(Type.Integer({minimum: 1, maximum: HIGHLIGHT_MAX_TIMEOUT_S, description: `等用户的上限（秒），缺省 ${String(HIGHLIGHT_DEFAULT_TIMEOUT_S)}；到点结局是 timeout`})),
}, {additionalProperties: false});

export type UiHighlightArgs = Static<typeof UiHighlightArgsSchema>;
export type UiSnapshotArgs = Static<typeof UiSnapshotArgsSchema>;
export type UiFindArgs = Static<typeof UiFindArgsSchema>;
export type UiScreenshotArgs = Static<typeof UiScreenshotArgsSchema>;

// ---------- 窗口 ----------

/** 窗口此刻的状态（选窗口用）：只读焦点、可见性与最近一次真实输入的时刻，不碰页面引擎。 */
export const WindowInfoSchema = Type.Object({
    /** 页面引擎的引用前缀，也是快照表头里的窗口名。 */
    name: Type.String({maxLength: 16}),
    title: Type.String({maxLength: 512}),
    path: Type.String({maxLength: 2048}),
    width: Type.Integer({minimum: 0}),
    height: Type.Integer({minimum: 0}),
    visible: Type.Boolean(),
    focused: Type.Boolean(),
    /** 最近一次用户真实输入（按键、指针按下、滚轮）的时刻，毫秒时间戳；还没有过为 null。 */
    lastInputAt: Type.Union([Type.Number(), Type.Null()]),
}, {additionalProperties: false});

export type WindowInfo = Static<typeof WindowInfoSchema>;

// ---------- 界面目录（输出 7） ----------

export const PathStepSchema = Type.Object({
    at: LocatorSchema,
    /** 这一步做完之后页面上会出现什么；最后一步是 null。 */
    appears: Type.Union([LocatorSchema, Type.Null()]),
}, {additionalProperties: false});

export const FindEntrySchema = Type.Object({
    kind: FindKindSchema,
    title: Type.String({maxLength: 512}),
    description: Type.Optional(Type.String({maxLength: 1024})),
    /** 设置键、节 id、视图 id 或命令 id。 */
    id: Type.String({maxLength: 512}),
    /** 从第一个还没完成的步骤给起；已经走到终点时只剩最后一步。 */
    path: Type.Array(PathStepSchema, {maxItems: 8}),
    /** 命令的快捷键，按本窗口的平台写。 */
    keybinding: Type.Optional(Type.String({maxLength: 64})),
    /** 命令此刻能从命令面板运行。 */
    palette: Type.Optional(Type.Boolean()),
}, {additionalProperties: false});

export type PathStep = Static<typeof PathStepSchema>;
export type FindEntry = Static<typeof FindEntrySchema>;

// ---------- 页面里的失败（窗口一侧交回） ----------

export const PageFailureDetailSchema = Type.Object({
    message: Type.String({maxLength: 1024}),
    candidates: Type.Optional(Type.Array(CandidateSchema, {maxItems: 10})),
}, {additionalProperties: false});

export type PageFailureDetail = Static<typeof PageFailureDetailSchema>;

const PAGE_ERRORS = {
    "stale-ref": PageFailureDetailSchema,
    ambiguous: PageFailureDetailSchema,
    "not-found": PageFailureDetailSchema,
    /** 定位对象写错了（例如给了两种主定位）。 */
    "invalid-locator": PageFailureDetailSchema,
};

/**
 * 高亮订阅推给服务端的事件（输出 9）：装上了（从这时起等用户）、页面上的结局，或没装上就失败。服务端收到结局或失败就退订，
 * 窗口那边随即撤掉高亮。
 */
export const HighlightEventSchema = Type.Union([
    Type.Object({kind: Type.Literal("installed"), window: WindowInfoSchema, ...HighlightInstalledSchema.properties}, {additionalProperties: false}),
    Type.Object({kind: Type.Literal("outcome"), outcome: PageOutcomeSchema}, {additionalProperties: false}),
    Type.Object({
        kind: Type.Literal("failed"),
        /** `guide-failed`：页面画不出高亮（引擎或宿主的钩子出错），服务端按窗口出错处理。 */
        code: Type.Union([Type.Literal("stale-ref"), Type.Literal("ambiguous"), Type.Literal("not-found"), Type.Literal("invalid-locator"), Type.Literal("window-hidden"), Type.Literal("guide-failed")]),
        detail: PageFailureDetailSchema,
    }, {additionalProperties: false}),
]);

export type HighlightEvent = Static<typeof HighlightEventSchema>;

/** 截图凭证的上传头（输出 8 的截图状态表）：凭证不放进路径，免得进 HTTP 诊断。 */
export const CAPTURE_TOKEN_HEADER = "x-nb-capture-token";
/** 上传地址：同源的相对路径，挂在本插件的 HTTP 路由下。 */
export const CAPTURE_UPLOAD_PATH = `/api/${PAGE_AGENT_PLUGIN}/captures`;
/** 截图的上限（输出 8）。 */
export const CAPTURE_MAX_BYTES = 512 * 1024;
export const CAPTURE_MAX_EDGE = 1280;

/**
 * 服务端调窗口（`provider: "client"`，只有服务端调）：选窗口时问 `info`，`ui` 的方法各一个；高亮要等用户，是订阅。窗口回复前按 UTF-8 量过大小
 * （核心包的上限），schema 里的字数与条数上限只是兜底。
 */
export const pageAgentWindowContract = defineRemoteService({
    id: `${PAGE_AGENT_PLUGIN}/window`,
    version: 1,
    provider: "client",
    callers: ["server"],
    methods: {
        info: {input: Type.Object({}, {additionalProperties: false}), output: WindowInfoSchema, effect: "read"},
        snapshot: {
            input: SnapshotArgsSchema,
            output: Type.Object({window: WindowInfoSchema, snapshot: SnapshotResultSchema}, {additionalProperties: false}),
            effect: "read",
            errors: PAGE_ERRORS,
        },
        find: {
            input: Type.Object({query: Type.String({minLength: 1, maxLength: 200}), kind: Type.Optional(FindKindSchema), limit: Type.Integer({minimum: 1, maximum: FIND_MAX_LIMIT})}, {additionalProperties: false}),
            output: Type.Object({window: WindowInfoSchema, entries: Type.Array(FindEntrySchema, {maxItems: FIND_MAX_LIMIT})}, {additionalProperties: false}),
            effect: "read",
        },
        capture: {
            input: Type.Object({token: Type.String({minLength: 16, maxLength: 128}), of: Type.Optional(LocatorSchema)}, {additionalProperties: false}),
            output: Type.Object({
                window: WindowInfoSchema,
                target: Type.Union([Type.Literal("window"), Type.Literal("element")]),
                width: Type.Integer({minimum: 1, maximum: CAPTURE_MAX_EDGE}),
                height: Type.Integer({minimum: 1, maximum: CAPTURE_MAX_EDGE}),
            }, {additionalProperties: false}),
            effect: "read",
            errors: {...PAGE_ERRORS, "window-hidden": PageFailureDetailSchema, "capture-failed": PageFailureDetailSchema},
        },
    },
    events: {
        highlight: {filter: HighlightArgsSchema, payload: HighlightEventSchema},
    },
});
