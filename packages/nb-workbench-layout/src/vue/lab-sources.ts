/// <reference types="vite/client" />
/**
 * 组件文档与模块，给应用的 Component Lab 建组件索引（docs/specs/ui/component-lab.md），与 nb-ui、nb-layout 的 `lab-sources` 同一种
 * 做法：消费方不必按本包的目录结构深导入源码。键是相对 `src/vue/` 的路径（`TabStrip.md`）。只供 Vite 消费方使用：
 * `import.meta.glob` 由 Vite 在构建时展开。
 */

/** 组件文档原文：相对路径 → Markdown。 */
export const nbWorkbenchLayoutComponentDocs: Readonly<Record<string, string>> = rekey(import.meta.glob<string>("./*.md", {query: "?raw", import: "default", eager: true}));

/** 组件模块的懒加载：相对路径 → loader。 */
export const nbWorkbenchLayoutComponentModules: Readonly<Record<string, () => Promise<unknown>>> = rekey(import.meta.glob("./*.vue"));

function rekey<T>(entries: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(entries).map(([path, value]) => [path.slice("./".length), value]));
}
