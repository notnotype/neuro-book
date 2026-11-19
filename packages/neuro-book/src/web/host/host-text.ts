/**
 * 给 Vue 根或子树提供宿主的文字（docs/specs/ui/i18n.md 输出 8）。nb-ui 与依赖它的共享包读 `TEXT_PORT_KEY`；nb-layout 不依赖
 * nb-ui，读自己的 `LAYOUT_TEXT_KEY`（一个翻译函数）。两样必须一起提供，否则 nb-layout 的组件在英文窗口里仍显示中文，所以
 * 应用里提供端口的地方都经这里，不直接 `provide(TEXT_PORT_KEY, …)`（`host-text.test.ts` 扫源码守着）。
 *
 * 交给 nb-layout 的函数把键转给同一个端口、命名空间 `nb-layout`：端口要登记了 nb-layout 的目录，`createHostTextEngine` 建的
 * 端口都登记了。
 */

import {LAYOUT_TEXT_KEY} from "@notnotype/nb-layout/text";
import type {LayoutTranslate} from "@notnotype/nb-layout/text";
import {NB_LAYOUT_NAMESPACE} from "@notnotype/nb-layout/locales";
import {textRef} from "@notnotype/nb-ui/text";
import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";
import type {TextPort} from "@notnotype/nb-ui/text-port";
import {provide} from "vue";
import type {App} from "vue";

/** 每次调用都经 `port.t` 读端口的当前语言，组件放进模板或 `computed` 里，换语言后会更新。 */
function layoutTranslate(port: TextPort): LayoutTranslate {
    return (key, params) => port.t(textRef(key, params, NB_LAYOUT_NAMESPACE));
}

/** 在组件的 `setup` 里调用：给这个组件的子树提供两样。 */
export function provideHostText(port: TextPort): void {
    provide(TEXT_PORT_KEY, port);
    provide(LAYOUT_TEXT_KEY, layoutTranslate(port));
}

/** 给一个 Vue 根提供两样，返回同一个 `app`，可以接着链式调用。 */
export function provideAppHostText<T>(app: App<T>, port: TextPort): App<T> {
    return app.provide(TEXT_PORT_KEY, port).provide(LAYOUT_TEXT_KEY, layoutTranslate(port));
}

/** 组件测试挂载用的注入表：`mount(…, {global: {provide: hostTextProvides(port)}})`。 */
export function hostTextProvides(port: TextPort): Record<symbol, unknown> {
    return {[TEXT_PORT_KEY as symbol]: port, [LAYOUT_TEXT_KEY as symbol]: layoutTranslate(port)};
}
