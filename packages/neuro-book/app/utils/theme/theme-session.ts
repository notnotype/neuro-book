import {applyColorway} from "@notnotype/nb-ui/colorway";
import type {NbColorwayVars} from "@notnotype/nb-ui/colorway";
import type {InstalledTheme} from "@notnotype/nb-ui/theme";
import {computed, readonly, ref} from "vue";
import type {ComputedRef, Ref} from "vue";
import {
    DEFAULT_PRODUCT_APPEARANCE,
    DEFAULT_PRODUCT_THEME_ID,
    productAppearances,
    productThemeIds,
    type ProductAppearance,
    type ProductThemeId,
} from "nbook/shared/theme/theme-axes";
import {productThemeOptions, productThemes, type ProductThemeOption} from "nbook/app/utils/theme/theme-packs";

/**
 * 产品主题会话（两轴：主题包 × 配色明暗）。
 *
 * 这是产品侧**唯一**的主题状态与落地点：
 *
 * · 状态：`themeId`（nbook / macos）与 `appearance`（light / dark）。具体配色 id 不落状态，
 *   它由当前主题包的 `manifest.defaultColorway[appearance]` 决定——各主题自带的配色是按自己的
 *   材料调的（macOS 玻璃在通用暗色下会发灰），所以「明暗」才是用户做选择的粒度。
 * · 落地点：`<html>`。主题包的取值写在 `:root[data-nb-theme="…"]`，配色变量又要在**声明处**
 *   完成代换（主题里大量 `color-mix(… var(--accent-main) …)`），所以属性和配色变量都必须落在
 *   文档根上，写页面根节点的话主题包整包选择器都匹配不到。
 * · 持久化：不在这里。Global Config 是唯一持久化（见 `useThemeSettings`），本模块只管内存与 DOM。
 *
 * 模块层单例：主题是全局的，登录页 / 管理页 / 工作台共享同一份状态。
 */
const themeId = ref<ProductThemeId>(DEFAULT_PRODUCT_THEME_ID);
const appearance = ref<ProductAppearance>(DEFAULT_PRODUCT_APPEARANCE);

const activeThemePack: ComputedRef<InstalledTheme | undefined> = computed(
    () => productThemes.find((theme) => theme.manifest.id === themeId.value),
);

/**
 * 当前配色 id。装载器保证 `defaultColorway` 指向的配色确实存在
 * （`colorway-mismatch` 会直接拒绝装载），所以这里不必再兜底。
 */
const activeColorwayId: ComputedRef<string | undefined> = computed(
    () => activeThemePack.value?.manifest.defaultColorway?.[appearance.value],
);

const activeColorwayVars: ComputedRef<NbColorwayVars | undefined> = computed(() => {
    const colorwayId = activeColorwayId.value;
    return colorwayId === undefined ? undefined : activeThemePack.value?.colorways[colorwayId];
});

/**
 * 把两轴落到文档根：`data-nb-theme` / `data-nb-appearance` / `colorScheme` + 配色变量。
 *
 * `style.colorScheme` 管浏览器原生 UI（滚动条、原生控件），`data-nb-appearance` 管主题分档——
 * 两者都必须写，且都取自**配色的明暗属性**而不是配色身份，理由见 nb-ui `colorway-store.ts`。
 *
 * 写变量这一步与 nb-ui 配色 store 同构（`applyColorway` 到 `<html>` 与 `<body>`）：
 * 产品与库共用一条落盘路径，不额外发明「先清后写」的第二套语义。
 */
function applyToDocument(): void {
    if (typeof document === "undefined") {
        return;
    }
    const root = document.documentElement;
    root.dataset.nbTheme = themeId.value;
    root.dataset.nbAppearance = appearance.value;
    root.style.colorScheme = appearance.value;

    const vars = activeColorwayVars.value;
    if (vars === undefined) {
        return;
    }
    applyColorway(root, vars);
    applyColorway(document.body, vars);
}

/** 两轴取值的白名单：老体系 id（sepia / tokyo-night / custom-*）与打错的值都落到默认。 */
const productThemeIdLookup: Record<string, true> = Object.fromEntries(productThemeIds.map((id) => [id, true]));
const productAppearanceLookup: Record<string, true> = Object.fromEntries(productAppearances.map((value) => [value, true]));

export type ProductThemeAxes = {
    themeId: ProductThemeId;
    appearance: ProductAppearance;
};

export type ProductThemeSession = {
    themeId: Readonly<Ref<ProductThemeId>>;
    appearance: Readonly<Ref<ProductAppearance>>;
    /** 当前主题包（nbook / macos），未装载时为 undefined */
    activeTheme: ComputedRef<InstalledTheme | undefined>;
    /** 当前配色 id（由主题包按明暗给出） */
    colorwayId: ComputedRef<string | undefined>;
    /** 当前配色变量取值表，供 JS 侧需要具体颜色的地方（如 Monaco）读取 */
    colorwayVars: ComputedRef<NbColorwayVars | undefined>;
    themes: readonly InstalledTheme[];
    themeOptions: readonly ProductThemeOption[];
    /** 设置两轴并落到 DOM。只改内存与文档，不写配置。 */
    setAxes: (next: Partial<ProductThemeAxes>) => void;
    /** 读持久化值：非法 / 缺失（含老字段、老 id）一律回落默认，不做映射。 */
    applyStoredAxes: (raw: {themeId?: unknown; appearance?: unknown}) => void;
};

const session: ProductThemeSession = {
    themeId: readonly(themeId),
    appearance: readonly(appearance),
    activeTheme: activeThemePack,
    colorwayId: activeColorwayId,
    colorwayVars: activeColorwayVars,
    themes: productThemes,
    themeOptions: productThemeOptions,
    setAxes(next) {
        if (next.themeId !== undefined) {
            themeId.value = next.themeId;
        }
        if (next.appearance !== undefined) {
            appearance.value = next.appearance;
        }
        applyToDocument();
    },
    applyStoredAxes(raw) {
        const storedThemeId = typeof raw.themeId === "string" ? raw.themeId : "";
        const storedAppearance = typeof raw.appearance === "string" ? raw.appearance : "";
        themeId.value = Object.hasOwn(productThemeIdLookup, storedThemeId)
            ? storedThemeId as ProductThemeId
            : DEFAULT_PRODUCT_THEME_ID;
        appearance.value = Object.hasOwn(productAppearanceLookup, storedAppearance)
            ? storedAppearance as ProductAppearance
            : DEFAULT_PRODUCT_APPEARANCE;
        applyToDocument();
    },
};

/** 首次求值就把默认两轴落下去：配置还没读回来之前，界面也是完整的主题。 */
if (typeof document !== "undefined") {
    applyToDocument();
}

export function useProductTheme(): ProductThemeSession {
    return session;
}
