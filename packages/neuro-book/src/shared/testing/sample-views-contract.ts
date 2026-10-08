/**
 * 测试插件 `test.sample-views` 的描述与开关（docs/specs/workbench/views.md 的 e2e）：只由测试引用。它只有浏览器入口，
 * 宿主测试入口按 `NBOOK_TEST_PLUGINS` 把描述加进本进程清单，引导接口才会把它列给 e2e 测试外壳。
 *
 * 开关是页面的 `localStorage` 键（测试用 `page.evaluate` 或 `addInitScript` 写），只在 e2e 构建里被读：
 * - `FAIL_ACTIVATION`：值为 "1" 时入口激活抛错；
 * - `FAIL_LOAD`、`FAIL_RENDER`：值是逗号分隔的视图 id，这些视图的 `load()` 失败、组件渲染时抛错。
 */

import type {PluginDescriptor} from "nbook/manifest";

export const sampleViewsDescriptor: PluginDescriptor = {id: "test.sample-views", version: "0.1.0", locations: ["browser"]};

export const SAMPLE_VIEW_IDS = {
    alpha: "test.sample-views.alpha",
    beta: "test.sample-views.beta",
    gamma: "test.sample-views.gamma",
    delta: "test.sample-views.delta",
    omega: "test.sample-views.omega",
} as const;

/** 测试命令：入口关闭自己这一代的激活作用域（真实的 `scope-closed` 撤回，声明仍在）。 */
export const SAMPLE_VIEWS_STOP_COMMAND = "test.sample-views.stop";

export const SAMPLE_VIEWS_SWITCHES = {
    failActivation: "test.sample-views/fail-activation",
    failLoad: "test.sample-views/fail-load",
    failRender: "test.sample-views/fail-render",
} as const;
