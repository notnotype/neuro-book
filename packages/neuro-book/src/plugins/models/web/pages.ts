/**
 * 两页的包装：设置窗口给 page 分区的组件传 `context`（页面上下文），这里把它拆成页面要的两样（当前层能不能写、写失败交给
 * 窗口通知），连同数据模块一起交给页面组件。页面组件因此只吃普通的属性，在 Lab 里能直接摆（做法同 `nbook.projects` 的
 * `createWorksPage`）。
 */

import {defineComponent, h} from "vue";
import type {Component, PropType} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";

import type {ModelsStore} from "./models-store";

export function modelsPage(component: Component, store: ModelsStore): Component {
    return defineComponent({
        name: "ModelsSettingsPage",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
        setup: (props) => () => h(component, {store, writable: props.context.writable.value, reportWriteFailure: props.context.reportWriteFailure}),
    });
}
