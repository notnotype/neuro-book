/**
 * 后端类型检查（tsc，`tsconfig.json`）看不懂单文件组件，而 bun 测试会导入工作台这类插件的浏览器入口，它们按需加载 `.vue`。
 * 这里只让 tsc 把 `.vue` 当作普通组件；组件本身的类型由 vue-tsc 的两遍检查覆盖（`tsconfig.web.json`、
 * `tsconfig.browser-test.json`，两者都不包含本目录）。
 */
declare module "*.vue" {
    import type {DefineComponent} from "vue";

    const component: DefineComponent<Record<string, unknown>>;
    export default component;
}
