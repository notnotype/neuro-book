/**
 * 桌面专属设置（docs/specs/runtime/desktop-shell.md 的“桌面专属设置”）：只在桌面壳的窗口里有意义的配置项与它们的设置分区。
 * 都只允许用户层：configuration.md 输出 22 把显示缩放这类只对本机有效的项留给 planned 的本机层，在它实现之前暂存于用户层
 * （桌面版的状态根本来在本机），本机层实现时迁过去。值由页面入口交给壳（`windowDesktopKey`），壳不读设置文件。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {SETTINGS_SECTIONS_POINT} from "nbook/plugins/settings/shared/contracts";
import type {WrittenSettingsSectionDeclaration} from "nbook/plugins/settings/shared/contracts";
import {defineSettings} from "nbook/shared/settings";

export const DESKTOP_PLUGIN = "nbook.desktop";

/** 界面缩放的档位，沿用 Chromium 的一组；命令与 Ctrl+滚轮在相邻两档之间移动。 */
const ZoomSchema = Type.Union([
    Type.Literal(0.5), Type.Literal(0.67), Type.Literal(0.75), Type.Literal(0.8), Type.Literal(0.9), Type.Literal(1),
    Type.Literal(1.1), Type.Literal(1.25), Type.Literal(1.5), Type.Literal(1.75), Type.Literal(2),
]);
export type ZoomLevel = Static<typeof ZoomSchema>;
/** 从小到大。 */
export const ZOOM_LEVELS: ReadonlyArray<ZoomLevel> = ZoomSchema.anyOf.map((member) => member.const);
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
        schema: ZoomSchema,
        default: DEFAULT_ZOOM,
        title: {"zh-CN": "界面缩放", "en-US": "Zoom"},
        description: {"zh-CN": "所有桌面窗口一起缩放。也可以按 Ctrl 加减号、Ctrl+0，或按住 Ctrl 滚动鼠标。", "en-US": "Zooms every desktop window. Also Ctrl with plus or minus, Ctrl+0, or Ctrl with the mouse wheel."},
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
});

export const desktopSectionContribution = {capability: SETTINGS_SECTIONS_POINT, id: DESKTOP_WINDOW_SECTION, declaration: DESKTOP_WINDOW_SECTION_DECLARATION};
