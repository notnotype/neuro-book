/// <reference types="vite/client" />
/**
 * 组件文档与组件模块的来源，给新应用的 Component Lab 建组件索引（docs/specs/ui/component-lab.md）。
 *
 * 由 nb-ui 自己导出，消费方就不必按 nb-ui 的目录结构深导入源码。键是相对 `src/components/` 的路径
 * （`controls/Button.md`）。只供 Vite 消费方使用：`import.meta.glob` 由 Vite 在构建时展开，Bun 与 Node 直接导入会失败。
 */

/** 组件文档原文：相对路径 → Markdown。 */
export const nbUiComponentDocs: Readonly<Record<string, string>> = rekey(
    import.meta.glob<string>("../components/**/*.md", {query: "?raw", import: "default", eager: true}),
);

/** 组件模块的懒加载：相对路径 → loader。 */
export const nbUiComponentModules: Readonly<Record<string, () => Promise<unknown>>> = rekey(import.meta.glob("../components/**/*.vue"));

function rekey<T>(entries: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(entries).map(([path, value]) => [path.slice("../components/".length), value]));
}
