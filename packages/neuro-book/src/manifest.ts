/**
 * 产品清单：本应用加载哪些插件，唯一入口。
 *
 * 这里只引用各插件的描述（`plugins/<插件>/plugin.ts`），不引用任何一侧的实现；后端与前端宿主
 * 各自按清单装配本侧入口，清单里写了某个运行位置、宿主却没有对应实现时装配直接失败。
 */

import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

import {descriptor as canon} from "./plugins/canon/plugin";
import {descriptor as plot} from "./plugins/plot/plugin";
import {descriptor as commands} from "./plugins/commands/plugin";
import {descriptor as diagnostics} from "./plugins/diagnostics/plugin";
import {descriptor as editor} from "./plugins/editor/plugin";
import {descriptor as explorer} from "./plugins/explorer/plugin";
import {descriptor as files} from "./plugins/files/plugin";
import {descriptor as htmlPreview} from "./plugins/html-preview/plugin";
import {descriptor as http} from "./plugins/http/plugin";
import {descriptor as imageViewer} from "./plugins/image-viewer/plugin";
import {descriptor as markdown} from "./plugins/markdown/plugin";
import {descriptor as plugins} from "./plugins/plugins/plugin";
import {descriptor as projects} from "./plugins/projects/plugin";
import {descriptor as settings} from "./plugins/settings/plugin";
import {descriptor as state} from "./plugins/state/plugin";
import {descriptor as agent} from "./plugins/agent/plugin";
import {descriptor as models} from "./plugins/models/plugin";
import {descriptor as storage} from "./plugins/storage/plugin";
import {descriptor as themeStudy} from "./plugins/theme-study/plugin";
import {descriptor as workbench} from "./plugins/workbench/plugin";

/**
 * 插件描述的类型归内核。浏览器入口随前端构建：窗口按 id 与版本核对后端引导返回的集合，不一致即提示刷新。
 * 各插件与宿主经本模块引用它。
 */
export type {PluginDescriptor};

export const productPlugins: ReadonlyArray<PluginDescriptor> = [diagnostics, http, state, settings, commands, storage, models, agent, plugins, workbench, projects, files, explorer, markdown, editor, imageViewer, htmlPreview, canon, plot, themeStudy];

export {definitionAt, pluginsAt, thirdPartyDefinition, thirdPartyDefinitionAt} from "./plugin-platform/shared/definitions";
export type {EntryLoader} from "./plugin-platform/shared/definitions";
