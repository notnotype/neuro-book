/**
 * 设置页的包装：设置窗口给 page 分区的组件传 `context`（页面上下文），这里把它拆成页面要的几样（当前层能不能写、写失败交给
 * 窗口通知），连同数据模块与本插件的配置服务（读写本插件的设置项）一起交给页面组件。页面组件因此只吃普通的属性，在 Lab 里能直接摆（同 `nbook.models` 的
 * `models/web/pages.ts`，那一个绑着模型的数据模块，不能复用）。
 */

import {defineComponent, h} from "vue";
import type {Component, PropType} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingsService} from "nbook/shared/settings";

import type {SearchStore} from "./search-store";

export function searchPage(component: Component, store: SearchStore, settings: SettingsService): Component {
    return defineComponent({
        name: "SearchSettingsHost",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
        setup: (props) => () => h(component, {store, settings, writable: props.context.writable.value, reportWriteFailure: props.context.reportWriteFailure}),
    });
}
