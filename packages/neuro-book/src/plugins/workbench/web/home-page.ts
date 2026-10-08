import {defineComponent, h} from "vue";
import type {Component, Ref, VNode} from "vue";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import type {DisplayLocale} from "nbook/shared/localized-text";

import type {LayoutHost} from "./state/layout-host";

/**
 * 工作台的 `/` 页：外壳（docs/specs/ui/workbench-shell.md 外壳一）、文档根的设置与命令宿主。页面单根：窗口的状态、
 * 实例与链路标记由页面出口透传到这个根上；窗口绑定了项目时根上带项目短名（`data-workbench-project`，全页只此一处）。
 *
 * 布局 store 在页面挂载时才取（`layout.acquire()`），直接打开 Lab 的窗口因此不读产品布局记录。
 *
 * 用渲染函数而不是单文件组件：窗口的合同测试在 bun test 中导入真实的工作台插件，bun 不能直接加载 `.vue`。外壳、
 * 文档根与命令宿主都是 `.vue`，由插件以异步组件交进来，渲染时才加载。
 */
export interface HomePageParts {
    readonly shell: Component;
    readonly renderDocument: () => VNode;
    readonly renderCommandHost: () => VNode;
    readonly layout: LayoutHost;
    readonly commands: CommandService;
    readonly projectName: string | null;
    readonly locale: Readonly<Ref<DisplayLocale>>;
}

export function createHomePage(parts: HomePageParts): Component {
    return defineComponent({
        name: "WorkbenchHomePage",
        setup() {
            const layout = parts.layout.acquire();
            return () => h("div", {"class": "nb-workbench-page", "data-workbench-root": "", ...(parts.projectName === null ? {} : {"data-workbench-project": parts.projectName})}, [
                parts.renderDocument(),
                h(parts.shell, {layout, commands: parts.commands, project: parts.projectName, locale: parts.locale.value}),
                parts.renderCommandHost(),
            ]);
        },
    });
}
