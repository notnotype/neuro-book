import type {PluginDescriptor} from "nbook/manifest";
import {PRODUCT_VERSION} from "nbook/shared/product";

import {WORKBENCH_THEMES_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ThemeDeclaration} from "nbook/plugins/workbench/shared/contracts";

const ICON_NAMES = ["files", "search", "settings", "message-square", "messages-square", "palette", "feather", "book-open-text", "pencil-line", "file-text"];
/** 手写的一套书页笔墨风图标，按 lucide 图标名覆盖（docs/specs/theme/skins.md 输出 16）；是 `currentColor` 的蒙版，亮暗共用同一批文件。 */
const ICONS = Object.fromEntries(ICON_NAMES.map((name) => [name, `assets/icons/${name}.svg`]));

const SERIF = "\"Noto Serif CJK SC\", \"Source Han Serif SC\", \"Songti SC\", serif";

/** “书房”（docs/specs/theme/skins.md 输出 11）：白天窗边、夜里台灯。只有声明与素材，没有入口；一张图裁给各位置。 */
const STUDY: ThemeDeclaration = {
    title: {"zh-CN": "书房", "en-US": "Study"},
    base: "nbook",
    fonts: {display: SERIF, prose: SERIF},
    crop: {
        empty: {position: "center 70%", contentX: 0.47},
        marginLeft: {size: "auto 118%", position: "0% 100%"},
        marginRight: {size: "auto 118%", position: "100% 100%"},
        sidebarCorner: {size: "1000px auto", position: "100% 2%"},
        auxiliaryCorner: {size: "1000px auto", position: "0% 100%"},
    },
    light: {
        colors: {
            "--color-scheme": "light",
            "--bg-main": "#fbf6ea", "--bg-panel": "#fbf6ea", "--bg-sidebar": "#f3ead8", "--bg-subtle": "#f3ead8", "--bg-input": "#fbf6ea", "--bg-hover": "#eddfc4",
            "--text-main": "#2e261c", "--text-secondary": "#54483a", "--text-muted": "#625542", "--text-inverse": "#fff9ee",
            "--border-color": "#e0d3bb", "--border-strong": "#c9b898", "--border-accent": "#8a5a24",
            "--accent-main": "#8a5a24", "--accent-bg": "#eddfc4", "--accent-text": "#7a4e1e",
            "--selection-bg": "#e8d6b0",
        },
        activityBar: {surface: "linear-gradient(90deg, #553a22, #6b4a2c 45%, #553a22)", foreground: "#f3e7d0", active: "#d9b878", ornament: "#d9b878"},
        frame: {line: "#8a5a24"},
        scene: "assets/study-day.webp",
        icons: ICONS,
    },
    dark: {
        colors: {
            "--color-scheme": "dark",
            "--bg-main": "#241c15", "--bg-panel": "#241c15", "--bg-sidebar": "#1b150f", "--bg-subtle": "#2c2319", "--bg-input": "#2a2119", "--bg-hover": "#3b2c1a",
            "--text-main": "#efe4d0", "--text-secondary": "#d6c7ad", "--text-muted": "#c2b296", "--text-inverse": "#241a0e",
            "--border-color": "#3d3125", "--border-strong": "#57483a", "--border-accent": "#e0ac62",
            "--accent-main": "#e0ac62", "--accent-bg": "#3b2c1a", "--accent-text": "#e8b870",
            "--selection-bg": "#4a3820",
        },
        activityBar: {surface: "linear-gradient(90deg, #2c1c10, #3a2616 45%, #2c1c10)", foreground: "#e9d9bc", active: "#c9a35f", ornament: "#c9a35f"},
        frame: {line: "#e0ac62"},
        scene: "assets/study-night.webp",
        icons: ICONS,
    },
};

export const descriptor: PluginDescriptor = {
    id: "nbook.theme-study",
    version: PRODUCT_VERSION,
    locations: [],
    contributions: [{capability: WORKBENCH_THEMES_POINT, id: "nbook.theme-study.study", declaration: STUDY}],
};
