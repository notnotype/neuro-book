import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import type {ProductThemeOption} from "nbook/app/utils/theme/theme-packs";
import type {ProductAppearance, ProductThemeId} from "nbook/shared/theme/theme-axes";

export type FrontendSettingsViewProps = {
    /** 界面语言 */
    locale: string;
    /** 默认视图模式 */
    viewMode: string;
    /** 推理强度（本地 UI 偏好） */
    reasoning: string;
    /** 推理强度可选值 */
    reasoningOptions: string[];
    /** 可选主题包：名字与一句话简介来自主题包 manifest，视图不写死 */
    themeOptions: readonly ProductThemeOption[];
    /** 当前主题包 id（两轴之一：材质、排版与控件密度） */
    themeId: ProductThemeId;
    /** 当前配色明暗（两轴之一） */
    appearance: ProductAppearance;
    /** 读取配置期间整段停用 */
    disabled?: boolean;
};

export type FrontendSettingsViewEmits = {
    (event: "update:locale", value: string): void;
    (event: "update:viewMode", value: string): void;
    (event: "update:reasoning", value: string): void;
    (event: "select-theme", themeId: ProductThemeId): void;
    (event: "select-appearance", appearance: ProductAppearance): void;
};

export function buildLocaleOptions(t: (key: string) => string): SelectOption[] {
    return [
        {
            value: "zh-CN",
            label: t("settings.frontend.simplifiedChinese"),
            description: t("settings.frontend.simplifiedChineseDescription"),
            iconClass: "i-lucide-languages",
        },
        {
            value: "en-US",
            label: t("settings.frontend.english"),
            description: t("settings.frontend.englishDescription"),
            iconClass: "i-lucide-languages",
        },
    ];
}

export function buildViewModeOptions(t: (key: string) => string): SelectOption[] {
    return [
        {value: "rich", label: t("settings.frontend.viewModeRich")},
        {value: "source", label: t("settings.frontend.viewModeSource")},
    ];
}
