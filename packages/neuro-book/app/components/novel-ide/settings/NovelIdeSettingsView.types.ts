/**
 * 设置界面的作用域：决定读写的配置层与可用区段。
 * `boot` 是启动期安全配置（只读说明），其余三档对应配置文件的全局 / 项目 / 浏览器段。
 */
export type SettingsScopeId = "boot" | "global" | "project" | "browser";

export type SettingsScopeOption = {
    value: SettingsScopeId;
    label: string;
    /** 悬停提示：说明这一档写到哪里。 */
    description: string;
    iconClass: string;
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
    githubUrl?: string;
    /** false */
    loading?: boolean;
    /** 空串 */
    loadError?: string;
};

export type NovelIdeSettingsViewEmits = {
    (event: "update:scope", value: SettingsScopeId): void;
    (event: "update:modelValue", value: string): void;
    (event: "reload"): void;
};
