/**
 * nb-form 场景的翻译端口。宿主注入了端口时 `SchemaForm`、`SchemaField` 的 `locale` 属性不起作用（语言以端口为准），而 Lab
 * 窗口的端口跟着窗口的语言走；场景要看哪种语言由场景输入里的 `locale` 决定（“English”写 `en-US`，其余中文），所以夹具按它
 * 另建一个宿主引擎（`createHostTextEngine` 登记了 nb-form 的目录），只注入给场景里的表单。做法同
 * `nb-agent-ui/agent-text.ts`。
 */

import {defineComponent, h, watch} from "vue";
import type {Component} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

/** 场景输入里的 `locale`：`en-US` 用英文，其余（包括没写）用中文。 */
function formSceneLocale(value: unknown): DisplayLocale {
    return value === "en-US" ? "en-US" : "zh-CN";
}

/** 给表单的根组件套一层场景端口；`locale` 属性照传，属性、事件与插槽原样转过去。 */
export function withFormSceneText(inner: Component): Component {
    return defineComponent({
        name: "LabFormSceneText",
        inheritAttrs: false,
        props: {locale: {type: String, default: undefined}},
        setup(props, {attrs, slots}) {
            const engine = createHostTextEngine({locale: formSceneLocale(props.locale)});
            provideHostText(engine.port);
            watch(() => formSceneLocale(props.locale), (next) => engine.setLocale(next));
            return () => h(inner, {...attrs, locale: props.locale}, slots);
        },
    });
}
