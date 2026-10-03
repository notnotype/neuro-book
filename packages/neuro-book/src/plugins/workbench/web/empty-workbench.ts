import {defineComponent, h} from "vue";

/**
 * 第 3 步的工作台：只证明窗口运行实例建立、`nbook.workbench` 激活后才挂载界面。外壳、命令与布局随第 4 步加入。
 * 用渲染函数而不是单文件组件：窗口的合同测试在 bun test 中导入真实的工作台插件，bun 不能直接加载 `.vue`。
 */
export const EmptyWorkbench = defineComponent({
    name: "EmptyWorkbench",
    setup() {
        return () => h("main", {class: "nb-empty-workbench", "data-workbench-root": ""}, [
            h("h1", "NeuroBook"),
            h("p", "工作台已就绪。"),
        ]);
    },
});
