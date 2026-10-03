/**
 * 主工作台外壳布局记录的产品定义（Nitro 与浏览器共用）。
 *
 * 与 `workbench-state.ts` 里的 user/local 记录一起，构成主工作台布局的完整声明来源：
 * Project 内左右栏尺寸是 `scope: "project"` 的 grid 布局记录（快照 v2 + 尺寸意图），
 * 未开项目/用户资产尺寸与书架模式是 `workbench.layout` 的 user/local 记录。
 *
 * **为什么这里不调用 t44 的 `defineGridLayoutState`**：那个工厂在
 * `app/utils/workbench/storage-grid-host.ts`，该模块连带 `@notnotype/nb-ui/components`（.vue 入口）
 * 与浏览器传输层，不能被 Nitro 打包；而定义实例必须同时存在于两侧——服务端要用 `validate` 与
 * `defaultValue` 校验落盘值（`server/storage/storage-value.ts`），浏览器侧要传给宿主。
 * 因此这里用 `defineStorageState` 声明同一份合同（owner/key/scope/records/schemaVersion/默认值/校验），
 * 由 `app/utils/workbench/shell-layout.ts` 把它接到宿主上，`shell-layout.test.ts` 交叉锁定
 * 「快照版本」「默认布局与纯几何的默认投影同源」「宿主读写往返」三项，两边不会各自漂移。
 *
 * 记录形状与 nb-ui 的 grid 快照 v2 同形：`{version, root}` 加未知字段。校验刻意放宽——
 * v1 与未知高版本必须以**读取分类**报告并保留原件，不能在定义边界变成读写异常。
 */

import {defineStorageState, type DefinedStorageState} from "nbook/shared/storage/definition";
import {
    WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH,
    WORKBENCH_LAYOUT_OWNER,
    WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH,
} from "nbook/shared/storage/workbench-state";

/** Project/local 的 grid 布局记录键；同 owner 的 user/local 记录用各自的键（尺寸表/书架模式）。 */
export const WORKBENCH_SHELL_LAYOUT_KEY = "layout";

/**
 * 记录载荷版本 = nb-ui 的 `GRID_SNAPSHOT_VERSION`（快照 v2）。
 *
 * 不能在这里 import nb-ui 取常量（见文件头），因此数值只此一处，并允许**所有记录版本**通过校验：
 * 版本判定归宿主的读取分类（v1 ⇒ legacy-value，更高 ⇒ unsupported-version），不是定义边界的事。
 */
export const WORKBENCH_SHELL_LAYOUT_SCHEMA_VERSION = 2;

/**
 * 无记录时的默认布局；与 `app/utils/workbench/layout.ts` 的 `projectShell` + `createShellGrid`
 * 在默认偏好下的投影结果同源，由交叉测试逐节点锁定（默认拓扑里的叶 id 是主动字段的落点，
 * 缺一个叶就写不进去）。
 */
export const WORKBENCH_SHELL_DEFAULT_LAYOUT_VIEWPORT = {width: 1440, height: 900} as const;

/** 默认布局里的固定叶尺寸：活动栏、标题栏、底部面板与状态栏（叶宽/高度公式另见 `layout.ts`）。 */
export const WORKBENCH_SHELL_DEFAULT_ACTIVITY_WIDTH = 60;
export const WORKBENCH_SHELL_DEFAULT_TITLEBAR_HEIGHT = 36;
export const WORKBENCH_SHELL_DEFAULT_PANEL_HEIGHT = 200;
export const WORKBENCH_SHELL_DEFAULT_STATUSBAR_HEIGHT = 22;

/** 每条可调整边界占 1px（与 `layout.ts` 的 `SASH_PX` 同值，这里只用于推导默认列宽）。 */
const DEFAULT_SASH = 1;

const DEFAULT_VIEWPORT = WORKBENCH_SHELL_DEFAULT_LAYOUT_VIEWPORT;
const DEFAULT_ACTIVITY = WORKBENCH_SHELL_DEFAULT_ACTIVITY_WIDTH;
const DEFAULT_LEFT = WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH;
const DEFAULT_RIGHT = WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH;
const DEFAULT_TITLEBAR = WORKBENCH_SHELL_DEFAULT_TITLEBAR_HEIGHT;
const DEFAULT_STATUSBAR = WORKBENCH_SHELL_DEFAULT_STATUSBAR_HEIGHT;
const DEFAULT_PANEL = WORKBENCH_SHELL_DEFAULT_PANEL_HEIGHT;

/** 主体（main）高度：容器高 − 标题栏 − 状态栏（main 两侧的 root 边界不占流内空间）。 */
const DEFAULT_MAIN_HEIGHT = DEFAULT_VIEWPORT.height - DEFAULT_TITLEBAR - DEFAULT_STATUSBAR;
/** body 宽：主体宽 − 活动栏（活动栏右侧边界 0px）。 */
const DEFAULT_BODY_WIDTH = DEFAULT_VIEWPORT.width - DEFAULT_ACTIVITY;
/** 中列（panel-stack）宽：body 宽 − 左栏 − 右栏 − 两条 1px sash。 */
const DEFAULT_STACK_WIDTH = DEFAULT_BODY_WIDTH - DEFAULT_LEFT - DEFAULT_RIGHT - DEFAULT_SASH * 2;
/** 编辑区高：主体高 − 面板高 − 一条 1px sash（面板在上时为 0）。 */
const DEFAULT_EDITOR_HEIGHT = DEFAULT_MAIN_HEIGHT - DEFAULT_PANEL - DEFAULT_SASH;

export type WorkbenchShellLayoutExtent = {readonly width: number; readonly height: number};

export type WorkbenchShellLayoutNode =
    | {
        readonly kind: "leaf";
        readonly id: string;
        readonly ref: string;
        readonly size: WorkbenchShellLayoutExtent;
    }
    | {
        readonly kind: "branch";
        readonly id: string;
        readonly orientation: "horizontal" | "vertical";
        readonly size: WorkbenchShellLayoutExtent;
        readonly children: readonly WorkbenchShellLayoutNode[];
    };

/** 一条外壳布局记录；未知字段（未来版本新增）原样保留。 */
export type WorkbenchShellLayoutRecord = {
    readonly version: number;
    readonly root: WorkbenchShellLayoutNode;
    readonly [field: string]: unknown;
};

/**
 * 默认外壳拓扑：`root V{titlebar, main H{activity, body H{left, panel-stack V{editor, panel}, right}}, statusbar}`
 * （默认 `bottom + center`：面板只在编辑区下方，绝不跨过活动栏）。
 *
 * 编辑器吸收余量：900 − 36（标题栏）− 22（状态栏）− 200（底部面板）− 1（editor | panel 的 sash）
 * − 60（活动栏）− 340（左栏）− 400（右栏）− 2（两条流内 sash）。
 *
 * 底部面板与状态栏在这里只是**默认呈现**：尺寸偏好归属 `workbench.layout/panel-size`，
 * 这条记录里的 panel 尺寸不是第二写者，旧记录缺这两个叶时也不会被补写。
 */
export const WORKBENCH_SHELL_DEFAULT_LAYOUT: WorkbenchShellLayoutRecord = Object.freeze({
    version: WORKBENCH_SHELL_LAYOUT_SCHEMA_VERSION,
    root: {
        kind: "branch",
        id: "root",
        orientation: "vertical",
        size: {width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height},
        children: [
            {
                kind: "leaf",
                id: "titlebar",
                ref: "titlebar",
                size: {width: DEFAULT_VIEWPORT.width, height: DEFAULT_TITLEBAR},
            },
            {
                kind: "branch",
                id: "main",
                orientation: "horizontal",
                size: {width: DEFAULT_VIEWPORT.width, height: DEFAULT_MAIN_HEIGHT},
                children: [
                    {
                        kind: "leaf",
                        id: "activity",
                        ref: "activity",
                        size: {width: DEFAULT_ACTIVITY, height: DEFAULT_MAIN_HEIGHT},
                    },
                    {
                        kind: "branch",
                        id: "body",
                        orientation: "horizontal",
                        size: {width: DEFAULT_BODY_WIDTH, height: DEFAULT_MAIN_HEIGHT},
                        children: [
                            {
                                kind: "leaf",
                                id: "left",
                                ref: "left",
                                size: {width: DEFAULT_LEFT, height: DEFAULT_MAIN_HEIGHT},
                            },
                            {
                                kind: "branch",
                                id: "panel-stack",
                                orientation: "vertical",
                                size: {width: DEFAULT_STACK_WIDTH, height: DEFAULT_MAIN_HEIGHT},
                                children: [
                                    {
                                        kind: "leaf",
                                        id: "editor",
                                        ref: "editor",
                                        size: {width: DEFAULT_STACK_WIDTH, height: DEFAULT_EDITOR_HEIGHT},
                                    },
                                    {
                                        kind: "leaf",
                                        id: "panel",
                                        ref: "panel",
                                        size: {width: DEFAULT_STACK_WIDTH, height: DEFAULT_PANEL},
                                    },
                                ],
                            },
                            {
                                kind: "leaf",
                                id: "right",
                                ref: "right",
                                size: {width: DEFAULT_RIGHT, height: DEFAULT_MAIN_HEIGHT},
                            },
                        ],
                    },
                ],
            },
            {
                kind: "leaf",
                id: "statusbar",
                ref: "statusbar",
                size: {width: DEFAULT_VIEWPORT.width, height: DEFAULT_STATUSBAR},
            },
        ],
    },
} as WorkbenchShellLayoutRecord);

/** 记录形状：只确认宿主理解的字段存在；未知字段与未知版本必须放行（见文件头）。 */
export function isWorkbenchShellLayoutRecord(value: unknown): value is WorkbenchShellLayoutRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate = value as {readonly version?: unknown; readonly root?: unknown};
    return typeof candidate.version === "number"
        && Number.isSafeInteger(candidate.version)
        && candidate.version >= 1
        && typeof candidate.root === "object"
        && candidate.root !== null
        && !Array.isArray(candidate.root);
}

/**
 * 建立主工作台外壳布局记录定义。
 *
 * `records: "single"`：一个 Project 一份外壳布局；插件 grid 与主 grid 即使叶名相同也不共享地址
 * （插件在自己的 owner 下声明 `identified` 资源）。
 */
export function defineWorkbenchShellLayoutState(): DefinedStorageState<WorkbenchShellLayoutRecord> {
    return defineStorageState<WorkbenchShellLayoutRecord>({
        owner: WORKBENCH_LAYOUT_OWNER,
        key: WORKBENCH_SHELL_LAYOUT_KEY,
        scope: "project",
        locality: "local",
        records: "single",
        schemaVersion: WORKBENCH_SHELL_LAYOUT_SCHEMA_VERSION,
        defaultValue: WORKBENCH_SHELL_DEFAULT_LAYOUT,
        validate: isWorkbenchShellLayoutRecord,
    });
}
