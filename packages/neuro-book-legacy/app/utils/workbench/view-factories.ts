/**
 * `factoryKey` → 视图组件的第一方解析器（L1 内置路径）。
 *
 * 提案 [workbench-view-host](../../../../packages/neuro-book/docs/proposals/workbench-view-host.md):98 要求
 * descriptor 只放 `factoryKey`，创建视图走**宿主白名单**：不存组件、不存模块路径、不存 HTML/CSS。
 * 第一版只有内置映射（模块随产品发布，用与将来第三方相同的注册键）；安装账本、权限与沙箱属 L3，
 * 不在本阶段。
 *
 * 懒实例化由宿主负责（视图首次可见才渲染，不可见就不存在实例）：本表是编译期已知的第一方模块的
 * 静态映射，因此不用 `import()` 做代码分割——那会把"哪些模块属于产品"从构建图里藏起来，
 * 而 L1 的价值恰恰是这份映射可被构建与审阅看见。
 */

import type {Component} from "vue";
import WorkspaceFilePanel from "nbook/app/components/novel-ide/workspace/WorkspaceFilePanel.vue";
import type {DescriptorResult} from "nbook/app/utils/workbench/descriptors";

/** 内置视图的 factory 表；键只在 descriptor 的 `factoryKey` 里出现。 */
const FIRST_PARTY_FACTORIES: Record<string, Component> = {
    "nbook.view.files": WorkspaceFilePanel,
};

export function resolveWorkbenchViewFactory(factoryKey: string): DescriptorResult<Component> {
    const component = FIRST_PARTY_FACTORIES[factoryKey];
    return component === undefined
        ? {ok: false, reason: `未登记的内置 factoryKey：${factoryKey}`}
        : {ok: true, value: component};
}
