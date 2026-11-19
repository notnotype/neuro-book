/**
 * 组件测试用的翻译端口：与窗口同一个宿主引擎（nb-ui、nb-agent-ui、nb-form、nb-markdown 与 `nbook.host` 的目录已登记），再登记
 * 给定插件的目录，严格模式下缺键、缺插值参数抛错。挂载时经 `provideText` 注入，组件里的 `useText()` 拿到的就是它（docs/specs/ui/i18n.md）。
 */

import type {TextPort} from "@notnotype/nb-ui/text-port";

import type {PluginCatalogs} from "nbook/shared/convention-keys";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {hostTextProvides} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

/** `plugins` 按命名空间（插件 id）给目录，例如 `{"nbook.plugins": pluginsCatalogs}`。 */
export function testTextPort(locale: DisplayLocale, plugins: Readonly<Record<string, PluginCatalogs>> = {}): TextPort {
    const engine = createHostTextEngine({locale, strict: true});
    for (const [ns, {source, catalogs}] of Object.entries(plugins)) engine.register(ns, catalogs, source);
    return engine.port;
}

/** `mount(…, {global: {provide: provideText(port)}})` 用的注入表：nb-ui 的端口与 nb-layout 的翻译函数一起（`web/host/host-text.ts`）。 */
export function provideText(port: TextPort): Record<symbol, unknown> {
    return hostTextProvides(port);
}
