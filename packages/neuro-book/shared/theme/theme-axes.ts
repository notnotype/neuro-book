/**
 * 产品主题的两条轴：主题包 id 与配色明暗。
 *
 * 放在 shared 层而不是 app 层，是因为 server 侧配置校验要用同一份清单，而 nb-ui 主题包
 * 会 `import "./vars.css"`——配置服务在 Node 里装不进主题包（旧体系同样把内置主题 id 放在这里）。
 *
 * 这份清单是配置 schema 的白名单：清单外的取值（老体系的 sepia / tokyo-night / custom-*）
 * 一律读作无效并回落到默认值，产品侧不留兼容层也不做映射。
 *
 * 具体配色 id 不在这里写死：每套主题包自己在 `manifest.defaultColorway` 里按明暗给出。
 */
export const productThemeIds = ["nbook", "macos"] as const;
export type ProductThemeId = typeof productThemeIds[number];

/** 配色明暗轴。颜色由配色层给，主题层按它分档。 */
export const productAppearances = ["light", "dark"] as const;
export type ProductAppearance = typeof productAppearances[number];

/** 默认主题包：nbook 是产品主题（macOS 玻璃 + 纸稿面）。 */
export const DEFAULT_PRODUCT_THEME_ID: ProductThemeId = "nbook";

/** 默认配色明暗：产品默认亮色（稿面是纸）。 */
export const DEFAULT_PRODUCT_APPEARANCE: ProductAppearance = "light";
