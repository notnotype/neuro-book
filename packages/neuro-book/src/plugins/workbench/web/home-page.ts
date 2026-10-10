import {computed, defineComponent, h, shallowRef, watch} from "vue";
import type {Component, VNode} from "vue";

import type {HomeProvider, HomeSource} from "./home-slot";

/**
 * 工作台的两个内置页面（docs/specs/ui/workbench-shell.md 外壳一与输出 36–37）：`/` 与 `/workbench`。页面单根：窗口的状态、
 * 实例与链路标记由页面出口透传到这个根上；窗口绑定了项目时根上带项目短名（`data-workbench-project`，全页只此一处）。
 * 文档根的设置与命令宿主两页都挂着；中间是外壳，或者（`/` 页、没有项目、有首页贡献时）首页贡献的组件。
 *
 * 外壳由 `renderShell` 渲染，布局 store 在那里面才取：首页贡献在场时不读产品布局记录，直接打开 Lab 的窗口也一样。
 *
 * 用渲染函数而不是单文件组件：窗口的合同测试在 bun test 中导入真实的工作台插件，bun 不能直接加载 `.vue`。
 */
export interface WorkbenchPageParts {
    readonly renderDocument: () => VNode;
    readonly renderShell: () => VNode;
    readonly renderCommandHost: () => VNode;
    readonly projectName: string | null;
    /** 首页贡献；只有 `/` 页在没有项目时用它。 */
    readonly home: HomeSource;
    /** 首页贡献加载失败时记诊断；页面退回外壳。 */
    readonly reportHome: (message: string) => void;
}

export interface WorkbenchPages {
    readonly home: Component;
    readonly workbench: Component;
}

export function createWorkbenchPages(parts: WorkbenchPageParts): WorkbenchPages {
    return {home: page("WorkbenchHomePage", parts, true), workbench: page("WorkbenchPage", parts, false)};
}

function page(name: string, parts: WorkbenchPageParts, useHome: boolean): Component {
    return defineComponent({
        name,
        setup() {
            const provider = computed<HomeProvider | null>(() => (useHome && parts.projectName === null ? parts.home.current.value : null));
            const loaded = shallowRef<{readonly provider: HomeProvider; readonly component: Component} | null>(null);
            const failed = shallowRef<HomeProvider | null>(null);
            // 提供者换了就重新加载；迟到的结果只在提供者没变时才用（撤回后不再渲染旧实现）。
            watch(provider, (current) => {
                loaded.value = null;
                failed.value = null;
                if (current === null) return;
                current.load().then(
                    (component) => {
                        if (provider.value === current) loaded.value = {provider: current, component};
                    },
                    (error: unknown) => {
                        if (provider.value !== current) return;
                        failed.value = current;
                        parts.reportHome(`首页 ${current.id} 加载失败，退回空工作台：${error instanceof Error ? error.message : String(error)}`);
                    },
                );
            }, {immediate: true});
            return () => {
                const current = provider.value;
                const homeShown = current !== null && failed.value !== current;
                const body = homeShown ? (loaded.value?.provider === current ? h(loaded.value.component) : null) : parts.renderShell();
                return h("div", {
                    "class": "nb-workbench-page",
                    "data-workbench-root": "",
                    ...(parts.projectName === null ? {} : {"data-workbench-project": parts.projectName}),
                    ...(homeShown ? {"data-workbench-home": current.id} : {}),
                }, [parts.renderDocument(), body, parts.renderCommandHost()]);
            };
        },
    });
}
