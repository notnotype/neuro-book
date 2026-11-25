/**
 * Lab 组件索引的扫描：共享前端组件（`src/ui/`）、各插件的界面组件（`src/plugins/<插件>/web/components/`）、
 * nb-ui、nb-form、nb-layout、nb-workbench-layout、nb-agent-ui 与 nb-markdown 的组件（经它们的公开入口 `lab-sources`），文档与组件同名并列。扫描结果换成
 * 逻辑路径（`ui/…`、`<插件>/…`、`nb-ui/<分类>/…`、`nb-form/…`、`nb-layout/…`、`nb-workbench-layout/…`、`nb-markdown/…`）交给 `buildLabIndex`；新插件的组件放进约定目录就会出现在
 * Lab 里，不用登记。Lab 自己的草稿区（`./drafts/`）归到 `drafts/…`。
 */

import {nbAgentUiComponentDocs, nbAgentUiComponentModules} from "@notnotype/nb-agent-ui/lab-sources";
import {nbFormComponentDocs, nbFormComponentModules} from "@notnotype/nb-form/lab-sources";
import {nbLayoutComponentDocs, nbLayoutComponentModules} from "@notnotype/nb-layout/lab-sources";
import {nbMarkdownComponentDocs, nbMarkdownComponentModules} from "@notnotype/nb-markdown/lab-sources";
import {nbUiComponentDocs, nbUiComponentModules} from "@notnotype/nb-ui/lab-sources";
import {nbWorkbenchLayoutComponentDocs, nbWorkbenchLayoutComponentModules} from "@notnotype/nb-workbench-layout/lab-sources";

import {buildLabIndex} from "./component-index-model";
import type {LabComponentEntry} from "./component-index-model";

export type {LabComponentEntry, LabComponentKind, LabDisplayMode} from "./component-index-model";
export {labComponentLabel, matchesLabQuery} from "./component-index-model";

const sharedDocs = import.meta.glob<string>("../../../ui/**/*.md", {query: "?raw", import: "default", eager: true});
const pluginDocs = import.meta.glob<string>("../../*/web/components/**/*.md", {query: "?raw", import: "default", eager: true});
const sharedModules = import.meta.glob("../../../ui/**/*.vue");
const pluginModules = import.meta.glob("../../*/web/components/**/*.vue");
/** 草稿区（`./drafts/<Work>-<Task>/`）：界面评审的静态稿，在导航里自成一组。 */
const draftDocs = import.meta.glob<string>("./drafts/**/*.md", {query: "?raw", import: "default", eager: true});
const draftModules = import.meta.glob("./drafts/**/*.vue");

/**
 * `../../../ui/a/X.md` → `ui/a/X.md`；`../../files/web/components/X.md` → `files/X.md`。Vite 把落在本文件所在目录下的
 * 结果写成相对本目录（Lab 自己的组件是 `./components/X.md`），归到 `lab/`。
 */
function logicalPath(path: string): string {
    if (path.startsWith("../../../ui/")) return path.slice("../../../".length);
    if (path.startsWith("./components/")) return `lab/${path.slice("./components/".length)}`;
    if (path.startsWith("./drafts/")) return path.slice("./".length);
    const [, plugin, rest] = /^\.\.\/\.\.\/([^/]+)\/web\/components\/(.+)$/u.exec(path) ?? [];
    if (plugin === undefined || rest === undefined) throw new Error(`组件路径不在约定目录里：${path}`);
    return `${plugin}/${rest}`;
}

const rekey = <T>(entries: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(entries).map(([path, value]) => [logicalPath(path), value]));
const prefixed = (prefix: string) => <T>(entries: Readonly<Record<string, T>>): Record<string, T> => Object.fromEntries(Object.entries(entries).map(([path, value]) => [`${prefix}/${path}`, value]));
const nbUi = prefixed("nb-ui");
const nbForm = prefixed("nb-form");
const nbLayout = prefixed("nb-layout");
const nbWorkbenchLayout = prefixed("nb-workbench-layout");
const nbAgentUi = prefixed("nb-agent-ui");
const nbMarkdown = prefixed("nb-markdown");

export const labComponents: LabComponentEntry[] = buildLabIndex(
    {
        docs: {...rekey(sharedDocs), ...rekey(pluginDocs), ...rekey(draftDocs), ...nbUi(nbUiComponentDocs), ...nbForm(nbFormComponentDocs), ...nbLayout(nbLayoutComponentDocs), ...nbWorkbenchLayout(nbWorkbenchLayoutComponentDocs), ...nbAgentUi(nbAgentUiComponentDocs), ...nbMarkdown(nbMarkdownComponentDocs)},
        modules: new Set(Object.keys({...rekey(sharedModules), ...rekey(pluginModules), ...rekey(draftModules), ...nbUi(nbUiComponentModules), ...nbForm(nbFormComponentModules), ...nbLayout(nbLayoutComponentModules), ...nbWorkbenchLayout(nbWorkbenchLayoutComponentModules), ...nbAgentUi(nbAgentUiComponentModules), ...nbMarkdown(nbMarkdownComponentModules)})),
    },
    (message) => console.warn(`[component-lab] ${message}`),
);

export function findLabComponent(name: string): LabComponentEntry | null {
    return labComponents.find((entry) => entry.name === name) ?? null;
}
