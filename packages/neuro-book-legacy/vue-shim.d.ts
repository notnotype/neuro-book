/**
 * Vue 单文件组件类型声明。
 * 让 tsc --noEmit 能识别 .vue 模块导入。
 */
declare module "*.vue" {
    import type { DefineComponent } from "vue";
    const component: DefineComponent<object, object, unknown>;
    export default component;
}
