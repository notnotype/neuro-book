import {defineComponent, h} from "vue";
import type {Component, VNode} from "vue";

/**
 * 工作台的 `/` 页：外壳与布局随 t50 加入，现在只证明窗口运行实例建立、`nbook.workbench` 激活后才挂载界面，
 * 页面上挂着命令宿主（命令面板与键位）。窗口绑定了项目时显示项目短名（`data-workbench-project`）。
 *
 * 用渲染函数而不是单文件组件：窗口的合同测试在 bun test 中导入真实的工作台插件，bun 不能直接加载 `.vue`。
 * 命令宿主是 `.vue`，由插件以异步组件交进来，渲染时才加载。
 */
export function createEmptyWorkbench(renderCommandHost: () => VNode, projectName: string | null): Component {
    return defineComponent({
        name: "EmptyWorkbench",
        setup() {
            return () => h("main", {class: "nb-empty-workbench", "data-workbench-root": ""}, [
                h("h1", "NeuroBook"),
                projectName === null ? h("p", "工作台已就绪。没有打开项目。") : h("p", {"data-workbench-project": projectName}, `工作台已就绪。当前项目：${projectName}`),
                renderCommandHost(),
            ]);
        },
    });
}
