/**
 * nb-agent-ui 场景的翻译端口。宿主注入了端口时对话视图、会话列表、模型目录的 `locale` 属性不起作用（语言以端口为准），
 * 而 Lab 窗口的端口跟着窗口的语言走；场景要看哪种语言由场景输入里的 `locale` 决定（“英文界面”写 `en-US`，缺省中文），
 * 所以夹具按它另建一个宿主引擎（`createHostTextEngine` 登记了 nb-agent-ui 与 nb-markdown 的目录；对话里 Markdown 图片的
 * “不在作品里”是 `nbook.markdown` 的键，eval 卡片的文字是 `nbook.agent` 的，都另外登记），只注入给场景里的组件。做法同
 * `workbench/web/lab/workbench-text.ts`。
 */

import {defineComponent, h, watch} from "vue";
import type {Component} from "vue";

import {agentCatalogs} from "nbook/plugins/agent/web/text";
import {markdownCatalogs} from "nbook/plugins/markdown/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

/** 场景输入里的 `locale`：`en-US` 用英文，其余（包括没写）用中文。 */
export function agentSceneLocale(value: unknown): DisplayLocale {
    return value === "en-US" ? "en-US" : "zh-CN";
}

/**
 * 夹具在 `setup` 里调用：按场景语言建端口并注入给后代；数据 tab 改了 `locale` 时跟着换。Vue 的 `inject` 只看祖先，
 * 同一个 `setup` 里随后调用的 `provideAgentView` 看到的仍是 Lab 窗口的端口，只有后代拿到这里的。
 */
export function provideAgentSceneText(locale: () => DisplayLocale): void {
    const engine = createHostTextEngine({locale: locale()});
    engine.register("nbook.markdown", markdownCatalogs.catalogs, markdownCatalogs.source);
    // `nbook.agent` 登记的渲染器（eval 卡片与它的详情）用自己的目录。
    engine.register("nbook.agent", agentCatalogs.catalogs, agentCatalogs.source);
    provideHostText(engine.port);
    watch(locale, (next) => engine.setLocale(next));
}

/** 给公开入口的根组件（会话列表、模型目录）套一层场景端口；`locale` 属性照传，属性、事件与插槽原样转过去。 */
export function withAgentSceneText(inner: Component): Component {
    return defineComponent({
        name: "LabAgentSceneText",
        inheritAttrs: false,
        props: {locale: {type: String, default: undefined}},
        setup(props, {attrs, slots}) {
            provideAgentSceneText(() => agentSceneLocale(props.locale));
            return () => h(inner, {...attrs, locale: props.locale}, slots);
        },
    });
}
