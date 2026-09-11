/**
 * 设置界面的作用域：决定读写的配置层与可用区段。
 * `boot` 是启动期安全配置（只读说明），其余三档对应配置文件的全局 / 项目 / 浏览器段。
 */
export type SettingsScopeId = "boot" | "global" | "project" | "browser";

export type SettingsScopeOption = {
    value: SettingsScopeId;
    /** 轨内只有约 61px 一档，所以用两字短标签，写到哪里交给 description。 */
    label: string;
    /** 悬停提示：说明这一档写到哪里。 */
    description: string;
    /** 非空表示当前不可进入（例如未打开项目），文本为原因。 */
    disabledReason?: string;
};

export type SettingsSectionOption = {
    value: string;
    label: string;
    description: string;
    iconClass: string;
    /** 该区段出现在哪些作用域下；实际可见区段是它与当前作用域的交集。 */
    scopes: SettingsScopeId[];
    /**
     * 内容布局。默认 `scroll`：外壳给内边距并拥有滚动，适合阅读型区段。
     * `fill`：区段自己占满内容区并管理内部滚动（两栏型、长列表型），外壳不加内边距也不再套一层滚动。
     */
    layout?: "scroll" | "fill";
};

/** 宿主准备好的只读上下文；视图不自行获取数据，也不访问 store 或 API。 */
export type NovelIdeSettingsViewProps = {
    /** 受控作用域。 */
    scope: SettingsScopeId;
    scopes: SettingsScopeOption[];
    sections: SettingsSectionOption[];
    /** 受控区段 id；切换作用域后若该区段不可用，视图会改选新作用域的第一个区段。 */
    modelValue: string;
    /** 项目作用域下的配置目标标签；空则不显示。 */
    targetLabel?: string;
    /** 左下角版本行；空则不显示。 */
    versionLabel?: string;
    /** 环境标注（Lab / 本地 / 生产）；只影响左下角那枚小标 */
    environmentLabel?: string;
    /** 「项目」作用域可切换的项目；为空时这一行退回只读的 targetLabel */
    projects?: Array<{id: string; name: string}>;
    /** 当前项目 id */
    activeProjectId?: string | null;
    githubUrl?: string;
    /** 整屏加载占位：只在确实没有内容可显示时用（宿主负责延时判据） */
    loading?: boolean;
    /** 有内容可显示时的后台重取：内容原地保留，只给一条细进度条 */
    busy?: boolean;
    /** 空串 */
    loadError?: string;
};

export type NovelIdeSettingsViewEmits = {
    (event: "update:scope", value: SettingsScopeId): void;
    (event: "update:modelValue", value: string): void;
    (event: "reload"): void;
    (event: "update:activeProjectId", value: string): void;
};
