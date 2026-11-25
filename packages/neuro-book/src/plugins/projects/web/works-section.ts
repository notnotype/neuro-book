/**
 * 设置窗口的“作品”分区（docs/specs/workbench/bookshelf.md 输出 21）：`nbook.projects` 向 `settings.sections` 贡献的 column
 * 页面，只在“用户”标签下可用。设置窗口只给页面 `context`；本插件的配置服务、目录选择器的数据来源与写不进去时的通知在这里
 * 接上。用渲染函数写：插件的合同测试在 bun test 里导入插件，bun 不能加载 `.vue`。
 */

import {defineComponent, h} from "vue";
import type {Component, PropType} from "vue";

import type {WrittenSettingsPageDeclaration} from "nbook/plugins/settings/shared/sections";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {Notifications} from "nbook/plugins/workbench/shared/contracts";
import type {SettingsFailure, SettingsService} from "nbook/shared/settings";

import {projectsText} from "../shared/text";
import type {BrowseOutcome} from "./browse";
import type {LibraryInfo} from "./shelf-page";

export const WORKS_SECTION = "nbook.works";

export const WORKS_SECTION_DECLARATION: WrittenSettingsPageDeclaration = {
    icon: "i-lucide-library",
    category: "app",
    order: 30,
    layout: "column",
    // 作品目录只允许用户层：“本作品”标签下这个分区停用。
    layers: ["user"],
};

export interface WorksPageOptions {
    /** `components/WorksSettingsPage.vue`。 */
    readonly component: Component;
    readonly settings: SettingsService;
    /** 目录选择器的数据来源（`PathPickerDialog` 的 `source`）。 */
    readonly source: {list(path: string | null): Promise<BrowseOutcome>};
    /** 当前有效的作品目录（远程 `library()`）；取不到为 null，诊断由提供方记。没设时页面据此显示缺省目录。 */
    readonly library: () => Promise<LibraryInfo | null>;
    readonly notifications: Notifications;
    /** 记诊断：作品目录或启动时打开没写进设置（用户已经看到通知）；`setting` 说是哪一项。 */
    readonly report: (setting: WorksWriteFailure["setting"], message: string) => void;
}

/** 页面里哪一项没写进设置。 */
export interface WorksWriteFailure {
    readonly setting: "library" | "startupOpen";
    readonly code: SettingsFailure;
    readonly detail: string;
}

export function createWorksPage(options: WorksPageOptions): Component {
    const failed = (failure: WorksWriteFailure): void => {
        const library = failure.setting === "library";
        options.report(failure.setting, `${library ? "作品目录" : "启动时打开"}没有写进设置：${failure.code}：${failure.detail}`);
        // 与书架“作品目录没写进设置”同一种去处（bookshelf.md“失败与恢复”）：通知。交文字引用，视口显示时按当前语言翻。
        const reason = `${failure.code}：${failure.detail}`;
        options.notifications.notify({
            tone: "warning",
            title: projectsText(library ? "shelf.libraryNotSavedTitle" : "worksSettings.startupNotSavedTitle"),
            message: library ? projectsText("shelf.libraryChangeNotSaved", {reason}) : projectsText("worksSettings.startupNotSaved", {reason}),
        });
    };
    return defineComponent({
        name: "WorksSettingsSection",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
        // 每次渲染读 context.layer：切换标签时窗口不重建页面，只是层变了（settings-window.md 输出 6）。
        setup: (props) => () => h(options.component, {
            layer: props.context.layer.value,
            settings: options.settings,
            source: options.source,
            readLibrary: options.library,
            onWriteFailed: failed,
        }),
    });
}
