import type {OptionSource} from "@notnotype/nb-form";
import type {FormOptionSources} from "@notnotype/nb-form/vue";
import type {Component, MaybeRefOrGetter, Ref} from "vue";

import type {SettingLayer} from "nbook/shared/settings";

/**
 * `nbook.settings` 的浏览器合同里依赖 Vue 的部分：page 分区（贡献点 `settings.pages`）的实现与页面上下文、选项提供者
 * （贡献点 `settings.choices`）的实现（docs/specs/settings/settings-window.md）。贡献点 id 与分区声明在 `shared/contracts.ts`，别的插件在运行时引用那里，
 * 这里的类型用 `import type`。page 分区的实现由 `settingsPageContribution` 包好，页面组件只收 `context` 与它给的属性。
 */

/** page 分区的实现：设置窗口第一次显示这个分区时才调用 `load()`，每次加载经当前的交付句柄取。 */
export interface SettingsPageImplementation {
    load(): Promise<Component>;
}

/**
 * 选项提供者的实现：设置窗口第一次要这个提供者的选项时调用一次 `source()`（同一次交付只调一次），之后读它给的响应式值。
 * 提供者自己的数据要取（例如向服务商要模型列表）时，自己报 `loading` 与 `unavailable`。
 */
export interface SettingsChoicesImplementation {
    source(): MaybeRefOrGetter<OptionSource<string>>;
}

/** page 分区的组件经只读的 `context` 属性收到它。 */
export interface SettingsPageContext {
    readonly id: string;
    /** 当前标签：“用户”或“本作品”；切换标签时变化，页面只编辑这一层。 */
    readonly layer: Readonly<Ref<SettingLayer>>;
    /** 窗口绑定的作品的书名；没有绑定作品时为 null。 */
    readonly projectTitle: Readonly<Ref<string | null>>;
    /**
     * 当前标签那一层能不能写：层 `invalid`、`unavailable` 时为假（输出 13）。页面自己的控件按它停用；放进
     * `SettingsPageActions` 的操作由窗口整体停用，不用再读它。
     */
    readonly writable: Readonly<Ref<boolean>>;
    /** 全部选项提供者的选项源，按提供者 id；直接交给页面里 `SchemaField`、`SchemaForm` 的 `options`。 */
    readonly options: FormOptionSources;
    /**
     * 告诉窗口有没有未保存的改动（输出 22）：有时离开页面先要用户确认。页面自己比较“已保存的值”与草稿；保存成功后报
     * false。页面卸载后再调用不起作用。
     */
    dirty(value: boolean): void;
    /**
     * 页面自己发起的写入没有成功（输出 14）：交给窗口发通知，文案、色调与通用分区的写入失败一致，页面不各发各的。
     * `subject` 是没保存的那一项，`reason` 是原因，两者都是页面按当前语言翻好的文字；`uncertain` 为真时写入结果未知
     * （例如请求发出后连接断了），通知标题换成“可能没有保存”。离开页面后晚到的失败照样通知。
     */
    reportWriteFailure(subject: string, failure: SettingsPageWriteFailure): void;
}

/** 页面写入失败的原因，见 `SettingsPageContext.reportWriteFailure`。 */
export interface SettingsPageWriteFailure {
    readonly reason: string;
    readonly uncertain?: boolean;
}
