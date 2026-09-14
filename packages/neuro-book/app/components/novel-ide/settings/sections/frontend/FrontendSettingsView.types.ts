import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import type {NbColorwayVars} from "@notnotype/nb-ui/colorway";
import type {ProductThemeOption} from "nbook/app/utils/theme/theme-packs";
import type {UserColorwayOption} from "nbook/app/utils/theme/theme-session";
import type {ProductAppearance, ProductThemeId} from "nbook/shared/theme/theme-axes";

/** 编辑器里的一份配色草稿：`id` 有值 = 改这一套（含重命名），没有 = 新建。 */
export type ColorwayDraft = {
    id?: string;
    label: string;
    appearance: ProductAppearance;
    vars: Record<string, string>;
};

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
    /** 当前生效配色的 id（主题自带配色或用户配色），未装载时为 undefined */
    colorwayId: string | undefined;
    /** 当前生效配色的展示名（编辑器里做「另存为」的起点文案） */
    colorwayLabel: string;
    /** 当前生效配色的取值表（编辑器里做「基于现有配色新建」的起点） */
    colorwayVars: NbColorwayVars;
    /** 当前生效配色是否出自用户库：决定「编辑 / 删除」可不可点 */
    colorwayIsUser: boolean;
    /** 用户配色库 */
    userColorways: readonly UserColorwayOption[];
    /** 读取配置期间整段停用 */
    disabled?: boolean;
};

export type FrontendSettingsViewEmits = {
    (event: "update:locale", value: string): void;
    (event: "update:viewMode", value: string): void;
    (event: "update:reasoning", value: string): void;
    (event: "select-theme", themeId: ProductThemeId): void;
    (event: "select-appearance", appearance: ProductAppearance): void;
    /** 选中一套配色（主题自带的或用户配色） */
    (event: "select-colorway", colorwayId: string): void;
    /** 新建 / 覆盖一套用户配色（`id` 有值是覆盖，没有是新建） */
    (event: "save-colorway", draft: ColorwayDraft): void;
    (event: "delete-colorway", colorwayId: string): void;
    /** 导出当前生效配色；下载动作留在宿主，视图不碰浏览器 API */
    (event: "export-colorway"): void;
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
