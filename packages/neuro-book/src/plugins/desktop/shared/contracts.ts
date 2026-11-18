/**
 * 桌面专属设置（docs/specs/runtime/desktop-shell.md 的“桌面专属设置”）：只在桌面壳的窗口里有意义的配置项与它们的设置分区。
 * 都只允许用户层：configuration.md 输出 22 把显示缩放这类只对本机有效的项留给 planned 的本机层，在它实现之前暂存于用户层
 * （桌面版的状态根本来在本机），本机层实现时迁过去。值由页面入口交给壳（`windowDesktopKey`），壳不读设置文件。
 */

import {Type} from "typebox";

import {SETTINGS_SECTIONS_POINT} from "nbook/plugins/settings/shared/contracts";
import type {WrittenSettingsSectionDeclaration} from "nbook/plugins/settings/shared/contracts";
import {CloseLastWindowSchema, WindowBackdropSchema, ZoomLevelSchema} from "nbook/shared/desktop-bridge";
import type {ZoomLevel} from "nbook/shared/desktop-bridge";
import {defineSettings} from "nbook/shared/settings";

import {desktopText} from "./text";

export const DESKTOP_PLUGIN = "nbook.desktop";

/** 界面缩放的档位，从小到大（schema 在桥里，壳也用它校验）；命令与快捷键在相邻两档之间移动。 */
export const ZOOM_LEVELS: ReadonlyArray<ZoomLevel> = ZoomLevelSchema.anyOf.map((member) => member.const);
export type {ZoomLevel};
/** 缺省的缩放，也是复位的目标。 */
export const DEFAULT_ZOOM: ZoomLevel = 1;

/** 设置窗口里的分区（只在桌面壳的窗口里列出）。 */
export const DESKTOP_WINDOW_SECTION = "nbook.desktop.window";
export const DESKTOP_WINDOW_SECTION_DECLARATION: WrittenSettingsSectionDeclaration = {
    title: {"zh-CN": "桌面窗口", "en-US": "Desktop Window"},
    description: {"zh-CN": "只在 NeuroBook 桌面版里生效。", "en-US": "Only takes effect in the NeuroBook desktop app."},
    icon: "i-lucide-monitor",
    category: "app",
    order: 20,
    host: "desktop",
};

export const {settings: desktopSettings, contributions: desktopSettingContributions} = defineSettings(DESKTOP_PLUGIN, {
    zoom: {
        schema: ZoomLevelSchema,
        default: DEFAULT_ZOOM,
        title: {"zh-CN": "界面缩放", "en-US": "Zoom"},
        description: {"zh-CN": "所有桌面窗口一起缩放。也可以按 Ctrl 加减号、Ctrl+0。在编辑器里按住 Ctrl 滚动鼠标改的是编辑器字号。", "en-US": "Zooms every desktop window. Also Ctrl with plus or minus, Ctrl+0. Ctrl with the mouse wheel in an editor changes the editor font size instead."},
        choices: ZOOM_LEVELS.map((level) => ({value: level, title: `${String(Math.round(level * 100))}%`})),
        layers: ["user"],
        section: DESKTOP_WINDOW_SECTION,
        order: 10,
    },
    openAtLogin: {
        schema: Type.Boolean(),
        default: false,
        title: {"zh-CN": "登录 Windows 时打开 NeuroBook", "en-US": "Open NeuroBook when you sign in to Windows"},
        description: {"zh-CN": "只对安装版、用缺省的数据目录时生效。卸载前先关掉它，卸载程序不会替你清掉。", "en-US": "Only for the installed app with the default data folder. Turn it off before uninstalling; the uninstaller does not remove it."},
        layers: ["user"],
        section: DESKTOP_WINDOW_SECTION,
        order: 20,
    },
    // 壳读的是页面交来的值（desktop-shell 输出 28、29），改了立刻对下一次关最后一个窗口生效。
    closeLastWindow: {
        schema: CloseLastWindowSchema,
        default: "quit",
        title: {"zh-CN": "关掉最后一个窗口时", "en-US": "When the last window closes"},
        description: {
            "zh-CN": "留在托盘时，注销或关机会由系统结束 NeuroBook，只保证已保存的内容。",
            "en-US": "While NeuroBook stays in the tray, signing out or shutting down lets Windows end it; only saved content is guaranteed.",
        },
        choices: [
            {value: "quit", title: {"zh-CN": "退出 NeuroBook", "en-US": "Quit NeuroBook"}},
            {value: "tray", title: {"zh-CN": "留在系统托盘（服务继续运行）", "en-US": "Stay in the system tray (the service keeps running)"}},
        ],
        layers: ["user"],
        section: DESKTOP_WINDOW_SECTION,
        order: 30,
    },
    // 壳在建窗口时按它定窗口是不是透明（desktop-shell 输出 32）：改了只对之后新开的窗口生效。
    windowBackdrop: {
        schema: WindowBackdropSchema,
        default: "off",
        title: {"zh-CN": "窗口背景", "en-US": "Window background"},
        description: {
            "zh-CN": "实验功能：磨砂透明的窗口背景，需要 Windows 11 22H2 以上。改了之后新开的窗口生效；打开后窗口没有系统菜单（Alt+空格）。",
            "en-US": "Experimental: a frosted, translucent window background; needs Windows 11 22H2 or later. Applies to windows opened after the change; the window has no system menu (Alt+Space) while it is on.",
        },
        choices: [
            {value: "off", title: {"zh-CN": "关", "en-US": "Off"}},
            {value: "mica", title: {"zh-CN": "Mica（壁纸色调）", "en-US": "Mica (wallpaper tint)"}},
            {value: "acrylic", title: {"zh-CN": "Acrylic（模糊背后的窗口）", "en-US": "Acrylic (blurs what is behind)"}},
        ],
        layers: ["user"],
        section: DESKTOP_WINDOW_SECTION,
        order: 40,
    },
    // 壳按页面交来的值删或补建桌面上的快捷方式（desktop-shell 输出 33）；只对安装版、缺省状态根的运行生效。
    // 标题省略，登记时补成约定键 `settings.desktopShortcut.title`；说明是可选字段，要自己写引用。
    desktopShortcut: {
        schema: Type.Boolean(),
        default: true,
        description: desktopText("settings.desktopShortcut.description"),
        layers: ["user"],
        section: DESKTOP_WINDOW_SECTION,
        order: 25,
    },
});

export const desktopSectionContribution = {capability: SETTINGS_SECTIONS_POINT, id: DESKTOP_WINDOW_SECTION, declaration: DESKTOP_WINDOW_SECTION_DECLARATION};
