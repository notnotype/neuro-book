/**
 * `nbook.projects` 的远程服务合同（docs/specs/runtime/projects.md 输出第 10、17 到 20 条）：
 * - `nbook.projects/projects`：浏览器（以后的 TUI）列出、登记、取书架、新建、修改作品信息、移出书架、作品目录与列目录；
 * - `nbook.projects/stats`：服务端向运行中的项目实例要实时的统计状态。
 * 列表与书架带项目目录路径，那是用户自己登记的位置，用来区分同名目录；服务端内部路径与子进程信息不在里面。
 * 书架条目、作品信息与统计快照的 schema 也在这里：远程合同的输出、统计记录（`stats-record.ts`）与界面类型（`shelf.ts`）
 * 引用同一份。两端共用，不碰 DOM、Bun 与 Node API。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {defineRemoteService} from "@notnotype/nb-runtime/remote";

import {RESOURCE_PATH_PATTERN} from "nbook/plugins/files/shared/contracts";
import {defineSetting} from "nbook/shared/settings";

import {projectsText} from "./text";

/** 书架案头的贡献位（别的插件往看板娘那一格上叠入口），声明在 `./desk`。 */
export {PROJECTS_DESK_POINT} from "./desk";

export const OPEN_PROJECT_COMMAND = "nbook.project.open";
/** 回到书架：本窗口整页导航到 `/`（docs/specs/workbench/commands.md 的“命令目录（项目）”）。 */
export const BACK_TO_SHELF_COMMAND = "nbook.project.back-to-shelf";

/** 作品目录：新建作品的缺省父目录（服务端上的路径），只在用户层；空串为没设。首次新建成功后由书架页写入。 */
export const librarySetting = defineSetting({
    plugin: "nbook.projects",
    name: "library",
    schema: Type.String(),
    default: "",
    // 标题省略，登记时补成约定键 `settings.library.title`；说明是可选字段，不补键，要自己写引用。
    description: projectsText("settings.library.description"),
    layers: ["user"],
    section: "nbook.works",
});

/**
 * 启动时打开（docs/specs/runtime/projects.md 的“启动时打开”）：桌面版启动、托盘或 Dock 开窗、`nbook` 打开浏览器时，经 `resume`
 * 路由进上次的作品还是书架。只在用户层，缺省上次的作品。
 */
export const startupOpenSetting = defineSetting({
    plugin: "nbook.projects",
    name: "startupOpen",
    schema: Type.Union([Type.Literal("last-work"), Type.Literal("shelf")]),
    default: "last-work",
    layers: ["user"],
    section: "nbook.works",
    choices: [{value: "last-work"}, {value: "shelf"}],
});

/** 作品信息的上限（docs/specs/runtime/projects.md 输出第 13 条）；校验在服务端做，输入 schema 只定形状，失败码带字段名。 */
export const PROJECT_TITLE_MAX_LENGTH = 80;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 500;
export const PROJECT_COLOR_PATTERN = /^#[0-9a-f]{6}$/u;
/** 项目 id 的形状（UUID）；身份文件、登记表与列目录用同一个判据。 */
export const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** 最近编辑的片段：该文件最后一个非空段落的开头。 */
export const SHELF_EXCERPT_MAX_LENGTH = 120;

const Empty = Type.Object({}, {additionalProperties: false});
const Detail = Type.Object({detail: Type.String()}, {additionalProperties: false});
const ReasonDetail = Type.Object({reason: Type.String(), detail: Type.String()}, {additionalProperties: false});
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) => Type.Union([schema, Type.Null()]);

export const ProjectRunStateSchema = Type.Union([Type.Literal("stopped"), Type.Literal("starting"), Type.Literal("running"), Type.Literal("idle-grace"), Type.Literal("stopping")]);

const ProjectView = Type.Object({
    id: Type.String(),
    name: Type.String(),
    path: Type.String(),
    state: ProjectRunStateSchema,
    generation: Nullable(Type.Integer()),
}, {additionalProperties: false});

export type ProjectView = Static<typeof ProjectView>;

/** 身份文件里的可选作品信息；没有的字段为 null。 */
export const ProjectMetadataSchema = Type.Object({
    title: Nullable(Type.String()),
    description: Nullable(Type.String()),
    /** `#rrggbb` 小写。 */
    color: Nullable(Type.String()),
    /** 封面文件相对作品目录的路径（规则见 `cover.ts`）；经 HTTP 路由上传与删除，不经 `update`。 */
    cover: Nullable(Type.String()),
}, {additionalProperties: false});

/** 书架上一部作品的封面：有文件才有，`version` 变了浏览器才重新取（取修改时间）。 */
export const ShelfCoverSchema = Type.Object({version: Type.String()}, {additionalProperties: false});

export type ProjectMetadata = Static<typeof ProjectMetadataSchema>;

/** 继续写作要打开的文件：只接受项目里的资源地址。 */
const PROJECT_ADDRESS_PATTERN = `^project://${RESOURCE_PATH_PATTERN.slice(1)}`;

export const ShelfLastEditSchema = Type.Object({
    address: Type.String({pattern: PROJECT_ADDRESS_PATTERN}),
    /** 显示用的片段名：文件名去掉扩展名。 */
    label: Type.String({minLength: 1}),
    /** ISO 时间。 */
    at: Type.String({minLength: 1}),
    excerpt: Type.String({maxLength: SHELF_EXCERPT_MAX_LENGTH}),
}, {additionalProperties: false});

export type ShelfLastEdit = Static<typeof ShelfLastEditSchema>;

/**
 * 项目实例算出、存进 user 分区记录的统计快照（docs/specs/runtime/projects.md 输出第 16 条）。`today.baseline` 是当天
 * 开始时的总字数：今天净增 = `words - baseline`，只在 `today.date` 是今天时有意义。
 */
export const ProjectStatsSnapshotSchema = Type.Object({
    /** ISO 时间：这份快照算完的时刻。 */
    computedAt: Type.String({minLength: 1}),
    words: Type.Integer({minimum: 0}),
    /** 计入的文件数（篇）。 */
    files: Type.Integer({minimum: 0}),
    /** 读不出的文件数：权限、编码、过大；不按 0 字计。 */
    unreadable: Type.Integer({minimum: 0}),
    today: Type.Object({
        /** 服务端所在机器的本地日期，`YYYY-MM-DD`。 */
        date: Type.String({pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"}),
        baseline: Type.Integer({minimum: 0}),
    }, {additionalProperties: false}),
    last: Nullable(ShelfLastEditSchema),
    /** 算字数用的方言声明表的指纹（docs/specs/runtime/projects.md 输出 16）；旧记录没有。 */
    wordRules: Type.Optional(Type.String({minLength: 1})),
}, {additionalProperties: false});

export type ProjectStatsSnapshot = Static<typeof ProjectStatsSnapshotSchema>;

/**
 * fresh：项目正在运行，统计完整；counting：项目正在运行，还在统计，数字是上次的快照；stale：项目没在运行（或在关闭
 * 后的宽限期里），是某时刻的快照；none：从没统计过。
 */
export const ShelfFreshnessSchema = Type.Union([Type.Literal("fresh"), Type.Literal("counting"), Type.Literal("stale"), Type.Literal("none")]);

export type ShelfFreshness = Static<typeof ShelfFreshnessSchema>;

export const ShelfStatsSchema = Type.Object({
    freshness: ShelfFreshnessSchema,
    /** ISO 时间；none 时为 null。 */
    computedAt: Nullable(Type.String()),
    words: Type.Integer({minimum: 0}),
    files: Type.Integer({minimum: 0}),
    unreadable: Type.Integer({minimum: 0}),
    /** 今天净增的字数（可为负）；快照不是今天的为 null。 */
    today: Nullable(Type.Integer()),
    last: Nullable(ShelfLastEditSchema),
}, {additionalProperties: false});

export type ShelfStats = Static<typeof ShelfStatsSchema>;

/** 书架上的一部作品：登记项、作品信息、封面与统计摘要。 */
export const ShelfItemSchema = Type.Object({
    id: Type.String(),
    /** 登记表的短名：地址栏的句柄，书名缺省时也用它显示。 */
    name: Type.String(),
    title: Nullable(Type.String()),
    description: Nullable(Type.String()),
    /** `#rrggbb`；没有时按 id 在主题色板里取一档。 */
    color: Nullable(Type.String()),
    /** 封面文件在且读得到才有；地址按 `projectCoverUrl(id, version)` 拼。 */
    cover: Nullable(ShelfCoverSchema),
    path: Type.String(),
    state: ProjectRunStateSchema,
    stats: ShelfStatsSchema,
}, {additionalProperties: false});

export type ShelfItem = Static<typeof ShelfItemSchema>;

const list = {
    input: Empty,
    output: Type.Array(ProjectView),
    effect: "read",
    errors: {"registry-invalid": Detail},
} as const;

const register = {
    input: Type.Object({path: Type.String({minLength: 1})}, {additionalProperties: false}),
    output: Type.Object({id: Type.String(), name: Type.String(), path: Type.String()}, {additionalProperties: false}),
    effect: "write",
    errors: {"register-failed": ReasonDetail},
} as const;

/** 列目录的一项：只有子目录；`project` 有身份文件，`registered` 已在书架上。 */
export const BrowseEntrySchema = Type.Object({
    name: Type.String(),
    path: Type.String(),
    kind: Type.Union([Type.Literal("project"), Type.Literal("registered"), Type.Literal("directory")]),
    title: Nullable(Type.String()),
}, {additionalProperties: false});

export type BrowseEntry = Static<typeof BrowseEntrySchema>;

export const projectsRemoteContract = defineRemoteService({
    id: "nbook.projects/projects",
    version: 5,
    provider: "server",
    callers: ["browser", "tui"],
    methods: {
        list,
        register,
        /** 全部作品的书架条目；一部作品的统计取不到只影响它自己（按 stale 或 none 给出）。 */
        shelf: {
            input: Empty,
            output: Type.Array(ShelfItemSchema),
            effect: "read",
            errors: {"registry-invalid": Detail},
        },
        /** 当前有效的作品目录：设置里的（`~` 已展开）或缺省的（系统文档目录下的 NeuroBook）；不保证存在。 */
        library: {
            input: Empty,
            output: Type.Object({path: Type.String(), source: Type.Union([Type.Literal("setting"), Type.Literal("default")])}, {additionalProperties: false}),
            effect: "read",
        },
        /**
         * 用系统的文件管理器打开作品目录（docs/specs/runtime/desktop-shell.md 输出 34 第四步）。路径由服务端自己取，不收调用方给的。
         * `missing` 是新用户的正常状态（第一次新建作品时才建）；其余失败的原因原文只进诊断。
         */
        revealLibrary: {
            input: Empty,
            output: Empty,
            effect: "write",
            errors: {
                missing: Empty,
                "not-directory": Empty,
                "not-accessible": Empty,
                "no-desktop": Empty,
                "open-failed": Empty,
            },
        },
        /** 列一个目录下的子目录（隐藏目录不列）；`path` 省略为作品目录，它不存在时为它的上一级。 */
        browse: {
            input: Type.Object({path: Type.Optional(Type.String({minLength: 1}))}, {additionalProperties: false}),
            output: Type.Object({path: Type.String(), parent: Nullable(Type.String()), entries: Type.Array(BrowseEntrySchema)}, {additionalProperties: false}),
            effect: "read",
            errors: {
                /** `reason` 同登记的目录校验：invalid-path、not-directory、not-accessible。 */
                "invalid-parent": ReasonDetail,
                "registry-invalid": Detail,
            },
        },
        /** 新建作品：建目录（不存在就建）、写身份文件、登记。`parent` 省略时用作品目录（设置或缺省）。 */
        create: {
            input: Type.Object({
                title: Type.String(),
                description: Type.Optional(Type.String()),
                parent: Type.Optional(Type.String({minLength: 1})),
            }, {additionalProperties: false}),
            output: Type.Object({id: Type.String(), name: Type.String(), path: Type.String()}, {additionalProperties: false}),
            effect: "write",
            errors: {
                "invalid-metadata": Type.Object({field: Type.String(), detail: Type.String()}, {additionalProperties: false}),
                /** `reason` 同登记的目录校验：invalid-path、not-directory、not-accessible（含建不出来）、inside-state-root；`detail` 带解析后的路径。 */
                "invalid-parent": ReasonDetail,
                /** 由书名生成的目录已存在。 */
                "exists": Type.Object({path: Type.String()}, {additionalProperties: false}),
                /** 身份文件写不进去；只装着本次写的东西的目录已删掉。 */
                "write-failed": Detail,
                /** 目录与身份文件已建好，登记失败；可以用“加入已有目录”接着完成。 */
                "register-failed": Type.Object({reason: Type.String(), detail: Type.String(), path: Type.String()}, {additionalProperties: false}),
            },
        },
        /** 修改作品信息：只改给出的字段，`null` 清除，省略不动。 */
        update: {
            input: Type.Object({
                id: Type.String({minLength: 1}),
                title: Type.Optional(Nullable(Type.String())),
                description: Type.Optional(Nullable(Type.String())),
                color: Type.Optional(Nullable(Type.String())),
            }, {additionalProperties: false}),
            output: Type.Object({id: Type.String(), title: Nullable(Type.String()), description: Nullable(Type.String()), color: Nullable(Type.String()), cover: Nullable(Type.String())}, {additionalProperties: false}),
            effect: "write",
            errors: {
                "unknown-project": Detail,
                "registry-invalid": Detail,
                "identity-invalid": Detail,
                /** 身份文件里的 id 与登记表不一致。 */
                "identity-conflict": Detail,
                "invalid-metadata": Type.Object({field: Type.String(), detail: Type.String()}, {additionalProperties: false}),
                "read-only": Detail,
                "write-failed": Detail,
            },
        },
        /**
         * 这个窗口绑定了作品：记成“上次的作品”，给启动时的 `resume` 路由用。id 要在登记表里，否则不记。后绑定的覆盖先绑定的，
         * 刷新再记一遍同一个值。
         */
        opened: {
            input: Type.Object({id: Type.String({minLength: 1})}, {additionalProperties: false}),
            output: Empty,
            effect: "write",
            errors: {
                "unknown-project": Detail,
                "registry-invalid": Detail,
                "write-failed": Detail,
            },
        },
        /** 移出书架：只改登记表，不动目录。 */
        unregister: {
            input: Type.Object({id: Type.String({minLength: 1})}, {additionalProperties: false}),
            output: Type.Object({id: Type.String(), name: Type.String()}, {additionalProperties: false}),
            effect: "write",
            errors: {
                "unknown-project": Detail,
                "registry-invalid": Detail,
                /** 项目不在 stopped：starting、running、idle-grace、stopping 都拒绝。 */
                "project-running": Type.Object({state: ProjectRunStateSchema}, {additionalProperties: false}),
                "write-failed": Detail,
            },
        },
    },
});

/**
 * 项目实例里的统计状态（docs/specs/runtime/projects.md 输出第 17 条）：服务端的 `shelf` 对运行中的作品经 `{project}` 目标
 * 问它。`counting` 时 `snapshot` 是上次的记录（可能为 null）；`ended` 是文件变更订阅已结束（根目录不在、提供方停止），
 * 之后不再更新。
 */
export const projectStatsRemoteContract = defineRemoteService({
    id: "nbook.projects/stats",
    version: 1,
    provider: "project",
    callers: ["server"],
    methods: {
        current: {
            input: Empty,
            output: Type.Object({
                status: Type.Union([Type.Literal("counting"), Type.Literal("complete"), Type.Literal("ended")]),
                snapshot: Nullable(ProjectStatsSnapshotSchema),
            }, {additionalProperties: false}),
            effect: "read",
        },
    },
});
