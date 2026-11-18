/// <reference types="vite/client" />
/**
 * 组件的文档与模块，给应用的 Component Lab 建组件索引（docs/specs/ui/component-lab.md），与 nb-ui、nb-agent-ui 的
 * `lab-sources` 同一种做法：消费方不必按本包的目录结构深导入源码。键是相对 `src/` 的路径（`chip/InlineChip.md`）。
 * 只扫组件目录：`language/codec/corpus/` 里的 `.md` 是编解码器的语料，不是组件文档。只供 Vite 消费方使用。
 */

/** 组件文档原文：相对路径 → Markdown。 */
export const nbMarkdownComponentDocs: Readonly<Record<string, string>> = rekey(import.meta.glob<string>(["../chip/**/*.md", "../display/**/*.md", "../prompt/**/*.md", "../editor/**/*.md"], {query: "?raw", import: "default", eager: true}));

/** 组件模块的懒加载：相对路径 → loader。 */
export const nbMarkdownComponentModules: Readonly<Record<string, () => Promise<unknown>>> = rekey(import.meta.glob(["../chip/**/*.vue", "../display/**/*.vue", "../prompt/**/*.vue", "../editor/**/*.vue"]));

function rekey<T>(entries: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(entries).map(([path, value]) => [path.slice("../".length), value]));
}
