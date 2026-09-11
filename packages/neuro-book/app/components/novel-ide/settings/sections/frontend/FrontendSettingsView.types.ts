import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import type {ThemeVars} from "nbook/app/utils/theme/theme-tokens";
import type {CustomThemeDto, ThemeAppearance} from "nbook/shared/theme/theme-vars";

/** 导入文件解析出来的主题文档：还没有 id，落盘时由宿主分配。 */
export type ImportedThemeDocument = {
    name: string;
    appearance: ThemeAppearance;
    /** 主题文档的短键形状（与 `CustomThemeDto` 一致），不是卡片预览用的 `--` 前缀形状 */
    vars: CustomThemeDto["vars"];
};

/** 迷你预览用该主题自己的变量绘制，所以卡片自带一份解析后的变量表。 */
export type FrontendThemeCard = {
    id: string;
    name: string;
    appearance: ThemeAppearance;
    vars: ThemeVars;
    /** 非空表示自定义主题，携带可编辑的原始 DTO */
    custom: CustomThemeDto | null;
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
    /** 内置主题卡片 */
    builtInThemeCards: FrontendThemeCard[];
    /** 自定义主题卡片 */
    customThemeCards: FrontendThemeCard[];
    /** 当前生效主题 id */
    activeThemeId: string;
    /** 当前生效主题的显示名 */
    activeThemeLabel: string;
    /** 当前生效主题是不是内置预设 */
    activeThemeIsBuiltIn: boolean;
    /** 读取配置期间整段停用 */
    disabled?: boolean;
};

export type FrontendSettingsViewEmits = {
    (event: "update:locale", value: string): void;
    (event: "update:viewMode", value: string): void;
    (event: "update:reasoning", value: string): void;
    (event: "select-theme", themeId: string): void;
    (event: "create-theme"): void;
    (event: "copy-theme", themeId: string): void;
    (event: "edit-theme", theme: CustomThemeDto): void;
    (event: "export-theme", themeId: string): void;
    (event: "delete-theme", theme: CustomThemeDto): void;
    /** 导入文件已解析成主题文档；落盘由宿主决定（含分配 id） */
    (event: "import-theme", theme: ImportedThemeDocument): void;
    /** 导入文件无法解析，附原因 */
    (event: "import-failed", message: string): void;
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
