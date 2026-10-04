/**
 * Lab 组件索引的扫描：共享前端组件（`src/ui/`）与各插件的界面组件（`src/plugins/<插件>/web/components/`），
 * 文档与组件同名并列。扫描结果换成逻辑路径（`ui/…`、`<插件>/…`）交给 `buildLabIndex`；新插件的组件放进约定目录
 * 就会出现在 Lab 里，不用登记。
 */

import {buildLabIndex} from "./component-index-model";
import type {LabComponentEntry} from "./component-index-model";

export type {LabComponentEntry, LabComponentKind, LabDisplayMode} from "./component-index-model";
export {labComponentLabel, matchesLabQuery} from "./component-index-model";

const sharedDocs = import.meta.glob<string>("../../../ui/**/*.md", {query: "?raw", import: "default", eager: true});
const pluginDocs = import.meta.glob<string>("../../*/web/components/**/*.md", {query: "?raw", import: "default", eager: true});
const sharedModules = import.meta.glob("../../../ui/**/*.vue");
const pluginModules = import.meta.glob("../../*/web/components/**/*.vue");

/**
 * `../../../ui/a/X.md` → `ui/a/X.md`；`../../files/web/components/X.md` → `files/X.md`。Vite 把落在本文件所在目录下的
 * 结果写成相对本目录（Lab 自己的组件是 `./components/X.md`），归到 `lab/`。
 */
function logicalPath(path: string): string {
    if (path.startsWith("../../../ui/")) return path.slice("../../../".length);
    if (path.startsWith("./components/")) return `lab/${path.slice("./components/".length)}`;
    const [, plugin, rest] = /^\.\.\/\.\.\/([^/]+)\/web\/components\/(.+)$/u.exec(path) ?? [];
    if (plugin === undefined || rest === undefined) throw new Error(`组件路径不在约定目录里：${path}`);
    return `${plugin}/${rest}`;
}

const rekey = <T>(entries: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(entries).map(([path, value]) => [logicalPath(path), value]));

export const labComponents: LabComponentEntry[] = buildLabIndex(
    {docs: {...rekey(sharedDocs), ...rekey(pluginDocs)}, modules: new Set(Object.keys({...rekey(sharedModules), ...rekey(pluginModules)}))},
    (message) => console.warn(`[component-lab] ${message}`),
);

export function findLabComponent(name: string): LabComponentEntry | null {
    return labComponents.find((entry) => entry.name === name) ?? null;
}
