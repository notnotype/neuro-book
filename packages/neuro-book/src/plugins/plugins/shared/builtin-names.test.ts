/** 插件页的内置插件名称与产品清单对得上：新加的内置插件有名称，改名、删掉的不留在表里；文字与迁到目录之前逐字相同。 */

import {describe, expect, it} from "bun:test";

import {productPlugins} from "nbook/manifest";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {BUILTIN_PLUGIN_IDS, builtinPluginTextKey} from "./builtin-names";

const CATALOGS = {"zh-CN": zhCN, "en-US": enUS} as const;

/** 迁到目录之前（`BUILTIN_PLUGIN_NAMES` 表）的中英文字，原样抄下；之后新加的内置插件（`nbook.desktop`、`nbook.bots`、`nbook.stickers`）也在这里写一份，与目录对照。 */
const LEGACY: Readonly<Record<string, {readonly name: Record<string, string>; readonly description: Record<string, string>}>> = {
    "nbook.bots": {name: {"zh-CN": "bot", "en-US": "Bots"}, description: {"zh-CN": "常驻的 bot：按插件交出的预设建出来，有自己的目录与一条长期的主对话。", "en-US": "Resident bots: created from presets that plugins provide, each with its own folder and one long-running main conversation."}},
    "nbook.stickers": {name: {"zh-CN": "表情包", "en-US": "Stickers"}, description: {"zh-CN": "表情包的目录与管理：你自己的、插件带来的与内置的表情包；Agent 回复里的表情按它找图。", "en-US": "Sticker packs: your own, those from plugins and the built-in ones; stickers in Agent replies are looked up here."}},
    "nbook.commands": {name: {"zh-CN": "命令", "en-US": "Commands"}, description: {"zh-CN": "登记与执行命令；命令面板与快捷键执行的都是这里登记的命令。", "en-US": "Registers and runs commands; the command palette and keybindings run the commands registered here."}},
    "nbook.desktop": {name: {"zh-CN": "桌面", "en-US": "Desktop"}, description: {"zh-CN": "桌面版的窗口设置：界面缩放（含快捷键与命令）、登录 Windows 时打开 NeuroBook、关掉最后一个窗口时退出还是留在系统托盘；设置分区只在桌面版的窗口里出现。", "en-US": "Window settings of the desktop app: zoom (with its shortcuts and commands), opening NeuroBook when you sign in to Windows, and whether closing the last window quits NeuroBook or keeps it in the system tray. The settings section appears only in desktop app windows."}},
    "nbook.editor": {name: {"zh-CN": "编辑器", "en-US": "Editor"}, description: {"zh-CN": "编辑区的标签与分组、文档的打开与保存。", "en-US": "Editor tabs and groups; opening and saving documents."}},
    "nbook.explorer": {name: {"zh-CN": "资源管理器", "en-US": "Explorer"}, description: {"zh-CN": "侧栏里作品的文件树。", "en-US": "The file tree of your book in the sidebar."}},
    "nbook.files": {name: {"zh-CN": "文件", "en-US": "Files"}, description: {"zh-CN": "读写作品目录里的文件与文件夹。", "en-US": "Reads and writes files and folders in your book."}},
    "nbook.html-preview": {name: {"zh-CN": "HTML 预览", "en-US": "HTML Preview"}, description: {"zh-CN": "在沙箱里预览 HTML 文件。", "en-US": "Previews HTML files in a sandbox."}},
    "nbook.http": {name: {"zh-CN": "本机服务", "en-US": "Local Server"}, description: {"zh-CN": "提供页面与接口的本机 HTTP 服务。", "en-US": "The local HTTP server for pages and APIs."}},
    "nbook.image-viewer": {name: {"zh-CN": "图片查看器", "en-US": "Image Viewer"}, description: {"zh-CN": "查看作品里的图片。", "en-US": "Views images in your book."}},
    "nbook.markdown": {name: {"zh-CN": "Markdown", "en-US": "Markdown"}, description: {"zh-CN": "作品的 Markdown 写法：读写规则、编辑器扩展与显示。", "en-US": "Markdown for your book: reading and writing rules, editor extensions and rendering."}},
    "nbook.canon": {name: {"zh-CN": "世界引擎", "en-US": "World engine"}, description: {"zh-CN": "作品的设定与剧情：条目、剧情变更、核对点与改动记录，按章算出每个位置上的样子。", "en-US": "The book's setting and story: entries, story changes, checks and the change history, worked out for every point in the book."}},
    "nbook.agent": {name: {"zh-CN": "Agent", "en-US": "Agent"}, description: {"zh-CN": "写作助手的会话与运行：接收插件给的扩展、工具与 Profile。", "en-US": "Writing assistant sessions and runs; takes the extensions, tools and profiles plugins provide."}},
    "nbook.models": {name: {"zh-CN": "模型服务", "en-US": "Model Service"}, description: {"zh-CN": "服务商与模型、密钥与模型角色；给写作助手提供模型。", "en-US": "Providers and models, keys and model roles; supplies models to the writing assistant."}},
    "nbook.network": {name: {"zh-CN": "网络", "en-US": "Network"}, description: {"zh-CN": "设置里的“网络”分区：模型列表的自动更新，以后还有代理。", "en-US": "The Network section in settings: automatic model list updates, and later a proxy."}},
    "nbook.plot": {name: {"zh-CN": "剧情", "en-US": "Story"}, description: {"zh-CN": "知识点与知情、伏笔、角色的目标：在世界引擎之上算出谁知道什么、伏笔走到了哪一步。", "en-US": "Knowledge, foreshadowing and character goals on top of the world engine: who knows what, and how far each setup has come."}},
    "nbook.plugins": {name: {"zh-CN": "插件管理", "en-US": "Plugin Manager"}, description: {"zh-CN": "安装、启用、禁用与卸载插件。", "en-US": "Installs, enables, disables and uninstalls plugins."}},
    "nbook.projects": {name: {"zh-CN": "作品", "en-US": "Books"}, description: {"zh-CN": "书架、作品的新建与打开。", "en-US": "The bookshelf; creating and opening books."}},
    "nbook.settings": {name: {"zh-CN": "设置", "en-US": "Settings"}, description: {"zh-CN": "设置窗口与设置项的读写。", "en-US": "The settings window and setting values."}},
    "nbook.state": {name: {"zh-CN": "公开状态", "en-US": "Public State"}, description: {"zh-CN": "插件之间共享的界面状态。", "en-US": "UI state shared between plugins."}},
    "nbook.storage": {name: {"zh-CN": "存储", "en-US": "Storage"}, description: {"zh-CN": "插件的记录与偏好。", "en-US": "Records and preferences for plugins."}},
    "nbook.tasks": {name: {"zh-CN": "后台任务", "en-US": "Background Tasks"}, description: {"zh-CN": "插件发起的长任务：进度、取消与重试，结束时发通知。", "en-US": "Long-running tasks started by plugins: progress, cancelling and retrying, and a notification when they finish."}},
    "nbook.theme-study": {name: {"zh-CN": "书房主题", "en-US": "Study Theme"}, description: {"zh-CN": "白天窗边、夜里台灯的一套外观。", "en-US": "A look for writing: a window by day, a desk lamp by night."}},
    "nbook.web": {name: {"zh-CN": "网页工具", "en-US": "Web Tools"}, description: {"zh-CN": "给写作助手的网页搜索与读取，经 DeepSeek 或 Tavily 的搜索接口。", "en-US": "Web search and page reading for the writing assistant, through the DeepSeek or Tavily search API."}},
    "nbook.workbench": {name: {"zh-CN": "工作台", "en-US": "Workbench"}, description: {"zh-CN": "工作台的外壳：侧栏、面板、标题栏与状态栏。", "en-US": "The workbench shell: sidebars, panel, title bar and status bar."}},
    "runtime.diagnostics": {name: {"zh-CN": "诊断", "en-US": "Diagnostics"}, description: {"zh-CN": "运行日志与诊断记录。", "en-US": "Runtime logs and diagnostic records."}},
};

/** 按目录键取文字：键是点号路径，逐段下钻。 */
const lookup = (catalog: object, key: string): unknown => key.split(".").reduce<unknown>((node, segment) => (typeof node === "object" && node !== null ? (node as Record<string, unknown>)[segment] : undefined), catalog);

describe("内置插件的名称与说明", () => {
    it("id 列表与产品清单一致，Lab 不在其中", () => {
        const ids = productPlugins.map((plugin) => plugin.id).sort();
        expect([...BUILTIN_PLUGIN_IDS].sort() as string[]).toEqual(ids);
        expect(builtinPluginTextKey("nbook.lab", "name")).toBeNull();
        expect(builtinPluginTextKey("nbook.lab", "description")).toBeNull();
        expect(builtinPluginTextKey("third.party", "name")).toBeNull();
    });

    it("每个内置插件在两种语言下都有名称与说明，文字与迁移前逐字相同，目录里没有多余的条目", () => {
        expect(Object.keys(LEGACY).sort()).toEqual([...BUILTIN_PLUGIN_IDS].sort());
        for (const id of BUILTIN_PLUGIN_IDS) {
            for (const field of ["name", "description"] as const) {
                const key = builtinPluginTextKey(id, field);
                expect(key).not.toBeNull();
                for (const [locale, catalog] of Object.entries(CATALOGS)) {
                    expect({id, field, locale, value: lookup(catalog, key!)}).toEqual({id, field, locale, value: LEGACY[id]![field]![locale]});
                }
            }
        }
        for (const catalog of Object.values(CATALOGS)) expect(Object.keys(catalog.builtin).length).toBe(BUILTIN_PLUGIN_IDS.length);
    });
});
