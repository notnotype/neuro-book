/**
 * 测试插件 `test.sample-views` 的描述与开关（docs/specs/workbench/views.md 的 e2e）：只由测试引用。它只有浏览器入口，
 * 宿主测试入口按 `NBOOK_TEST_PLUGINS` 把描述加进本进程清单，引导接口才会把它列给 e2e 测试外壳。
 *
 * 开关是页面的 `localStorage` 键（测试用 `page.evaluate` 或 `addInitScript` 写），只在 e2e 构建里被读：
 * - `FAIL_ACTIVATION`：值为 "1" 时入口激活抛错；
 * - `FAIL_LOAD`、`FAIL_RENDER`：值是逗号分隔的视图 id，这些视图的 `load()` 失败、组件渲染时抛错；
 * - `WITH_RAIL`：值为 "1" 时另贡献右栏的受限视图 `rail`（位置限制，views.md 输出 22；视图段，输出 21）。插件创建时读一次，所以要在页面加载前写（`addInitScript`）；
 *   不默认贡献，别的用例里右栏的入口不跟着多一个。
 * - `RAIL_BOUNDS`：`rail` 视图段的范围，JSON `{width, minimum, maximum, chatMinimum}`；不写时是 `SAMPLE_RAIL_BOUNDS`。同样在插件创建时读。
 */

import type {PluginDescriptor} from "nbook/manifest";

export const sampleViewsDescriptor: PluginDescriptor = {id: "test.sample-views", version: "0.1.0", locations: ["browser"]};

export const SAMPLE_VIEW_IDS = {
    alpha: "test.sample-views.alpha",
    beta: "test.sample-views.beta",
    gamma: "test.sample-views.gamma",
    delta: "test.sample-views.delta",
    omega: "test.sample-views.omega",
    zeta: "test.sample-views.zeta",
    /** 右栏的受限视图：只停右栏、只用自己的隐式容器、浮动时只能独占一个窗。只在开关 `withRail` 打开时贡献。 */
    rail: "test.sample-views.rail",
} as const;

/** 编辑器槽的样例贡献。 */
export const SAMPLE_EDITOR_AREA_ID = "test.sample-views.editor-area";

/** 测试命令：入口关闭自己这一代的激活作用域（真实的 `scope-closed` 撤回，声明仍在）。 */
export const SAMPLE_VIEWS_STOP_COMMAND = "test.sample-views.stop";

/** 样例视图丙自己声明、收进“⋯”的标题动作执行的命令：什么都不做（docs/specs/workbench/views.md 验收 8）。 */
export const SAMPLE_VIEWS_MARK_COMMAND = "test.sample-views.mark";

/**
 * 页面上派发这个名字的 `CustomEvent`（`detail` 是 `{command, args}`），插件就执行这条命令。给 e2e 在拖动进行中执行命令用
 * （docs/specs/ui/workbench-layout.md 验收 32）：那时按键归拖动会话，点不了菜单，`page.evaluate` 派发事件不碰指针与焦点。
 */
export const SAMPLE_VIEWS_RUN_EVENT = "test.sample-views/run-command";

export const SAMPLE_VIEWS_SWITCHES = {
    failActivation: "test.sample-views/fail-activation",
    failLoad: "test.sample-views/fail-load",
    failRender: "test.sample-views/fail-render",
    withRail: "test.sample-views/with-rail",
    railBounds: "test.sample-views/rail-bounds",
} as const;

/** `rail` 视图段的缺省范围：同消息视图（conversation 输出 57）。 */
export const SAMPLE_RAIL_BOUNDS = {width: 260, minimum: 200, maximum: 420, chatMinimum: 320} as const;
