import {defineComponent, h} from "vue";
import type {Component, Ref, VNode} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

/**
 * 工作台的 `/` 页：外壳与布局随 t50 加入，现在只证明窗口运行实例建立、`nbook.workbench` 激活后才挂载界面，
 * 页面上挂着命令宿主（命令面板与键位）。窗口绑定了项目时显示项目短名（`data-workbench-project`）。
 *
 * 用渲染函数而不是单文件组件：窗口的合同测试在 bun test 中导入真实的工作台插件，bun 不能直接加载 `.vue`。
 * 命令宿主是 `.vue`，由插件以异步组件交进来，渲染时才加载。
 */
const MESSAGES = {
    ready: {"zh-CN": "工作台已就绪。没有打开项目。", "en-US": "The workbench is ready. No project is open."},
    readyWithProject: {"zh-CN": "工作台已就绪。当前项目：{name}", "en-US": "The workbench is ready. Current project: {name}"},
} satisfies Record<string, LocalizedText>;

/**
 * `locale` 是当前显示语言（从配置读）：文案按它渲染，语言切换不重新加载页面。`renderDocument` 渲染设置文档根
 * （`<html lang>`）的组件，与命令宿主一样由插件以异步组件交进来。
 */
export function createEmptyWorkbench(renderCommandHost: () => VNode, renderDocument: () => VNode, projectName: string | null, locale: Readonly<Ref<DisplayLocale>>): Component {
    return defineComponent({
        name: "EmptyWorkbench",
        setup() {
            return () => h("main", {class: "nb-empty-workbench", "data-workbench-root": ""}, [
                renderDocument(),
                h("h1", "NeuroBook"),
                projectName === null
                    ? h("p", localize(MESSAGES.ready, locale.value))
                    : h("p", {"data-workbench-project": projectName}, localize(formatText(MESSAGES.readyWithProject, {name: projectName}), locale.value)),
                renderCommandHost(),
            ]);
        },
    });
}
