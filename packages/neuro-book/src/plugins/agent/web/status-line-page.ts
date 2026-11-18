/**
 * “状态栏”设置页的包装（conversation.md 输出 46）：页面组件只吃普通的属性，能在 Lab 里直接摆；这里读配置与目录里插件的项，
 * 把勾选与排序写回用户层，写失败交给窗口通知。做法同权限规则页（`permission-page.ts`）。
 */

import {defineComponent, h} from "vue";
import type {Component, PropType} from "vue";
import {statusLineCatalog} from "@notnotype/nb-agent-ui";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import {settingsFailureText} from "nbook/ui/settings/setting-text";
import type {TextResolver} from "nbook/shared/localized-text";
import type {SettingsService, SettingWriteResult} from "nbook/shared/settings";

import {agentSettings} from "../shared/settings";
import {agentText} from "../shared/text";
import type {StatusItems} from "./status-items";
import type {StatusLineWriter} from "./status-line-writes";

export function statusLinePage(component: Component, deps: {
    readonly settings: SettingsService;
    readonly items: StatusItems;
    readonly writer: StatusLineWriter;
    readonly text: TextResolver;
}): Component {
    return defineComponent({
        name: "StatusLineSettingsPage",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
        setup: (props) => {
            const reportIfFailed = (result: SettingWriteResult): void => {
                if (result.ok) return;
                props.context.reportWriteFailure(deps.text.t(agentText("statusLine.notSaved")), {reason: settingsFailureText(result.code, result.detail, deps.text), uncertain: result.code === "unknown-outcome"});
            };
            return () => h(component, {
                pluginItems: deps.items.items.value,
                setting: deps.settings.get(agentSettings.settings.statusLine),
                writable: props.context.writable.value,
                onToggle: (id: string) => void deps.writer.toggle(id).then(reportIfFailed),
                onMove: (id: string, to: number) => void deps.writer.move(id, to).then(reportIfFailed),
                onShift: (id: string, delta: number) => void deps.writer.shift(id, delta).then(reportIfFailed),
            });
        },
    });
}

/** 页面与宿主算目录用同一个函数：内置四项加已发布的插件项。 */
export const statusCatalog = (items: StatusItems) => statusLineCatalog(items.items.value);
