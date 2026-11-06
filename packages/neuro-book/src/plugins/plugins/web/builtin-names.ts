/**
 * 插件页给内置插件显示的名称与说明。第三方插件的显示名与说明来自它的清单（package.json 的 displayName、description）；
 * 内置插件的描述符没有这两项，服务端的插件列表也不带界面语言，所以放在页面这一侧：文字在本插件的目录里
 * （`builtin.<id>.name`、`builtin.<id>.description`），按界面语言取。表里没有的 id 只显示 id：
 * 只在开发模式出现的 Lab 不进表，生产产物里不能有它的名字（`check:dist`）。
 */

import type {PluginsTextKey} from "./text";

/** 有名称与说明的内置插件 id；新加的内置插件在这里登记，并在两份目录里补键（`builtin-names.test.ts` 对照产品清单检查）。 */
export const BUILTIN_PLUGIN_IDS = [
    "nbook.agent",
    "nbook.canon",
    "nbook.commands",
    "nbook.editor",
    "nbook.explorer",
    "nbook.files",
    "nbook.html-preview",
    "nbook.http",
    "nbook.image-viewer",
    "nbook.markdown",
    "nbook.models",
    "nbook.plot",
    "nbook.plugins",
    "nbook.projects",
    "nbook.settings",
    "nbook.state",
    "nbook.storage",
    "nbook.theme-study",
    "nbook.workbench",
    "runtime.diagnostics",
] as const;

export type BuiltinPluginId = (typeof BUILTIN_PLUGIN_IDS)[number];

/**
 * 目录键里的 id 段：i18next 把键里的 `.` 当嵌套分隔符，id 里的点（`nbook.commands`）不能直接当对象的键，
 * 所以目录里写成 `nbook-commands`。id 里原本就有连字符（`nbook.html-preview`），转换只换点，不会撞名：每个 id 只含一个点。
 */
type KeySegment<Id extends string> = Id extends `${infer Namespace}.${infer Name}` ? `${Namespace}-${Name}` : Id;

const keySegment = <Id extends BuiltinPluginId>(id: Id): KeySegment<Id> => id.replaceAll(".", "-") as KeySegment<Id>;

const BUILTIN_IDS: ReadonlySet<string> = new Set(BUILTIN_PLUGIN_IDS);

/** 内置插件 id 的名称或说明在 `nbook.plugins` 目录里的键；表里没有的 id 返回 null。 */
export function builtinPluginTextKey(id: string, field: "name" | "description"): PluginsTextKey | null {
    if (!BUILTIN_IDS.has(id)) return null;
    return `builtin.${keySegment(id as BuiltinPluginId)}.${field}`;
}
