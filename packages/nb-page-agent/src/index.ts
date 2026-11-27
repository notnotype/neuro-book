/**
 * 页面引擎入口：在浏览器里用。参数与返回的形状在 `./api`（不碰 DOM，前后端都能引用），稳定名的写法在 `./attrs`。
 */

export {createPageAgent} from "./engine";
export type {PageAgent, PageAgentOptions} from "./engine";
export {ENGLISH_GUIDE_TEXT, GUIDE_THEME_DEFAULTS, TARGET_WAIT_MS} from "./guide";
export type {GuideOptions, GuideText, GuideTheme, GuideThemeSlot, HighlightEnd, HighlightHandle} from "./guide";
export type {Located, LocateOptions} from "./locate";
export {randomRefPrefix} from "./refs";
