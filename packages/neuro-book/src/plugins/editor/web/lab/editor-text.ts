/**
 * 编辑器区夹具的翻译端口：Lab 窗口的端口不登记本插件的目录，所以夹具另建一个宿主引擎、登记 `nbook.editor` 的目录（Markdown
 * 控件里图片的“不在作品里”是 `nbook.markdown` 的键，也登记它），
 * 只注入给场景里的零件（做法同 `explorer/web/lab/explorer-text.ts`）。场景 id 是 `english` 的用英文界面，其余用中文；
 * 编辑器区没有 `locale` 属性，语言只由场景决定。
 */

import type {TextPort} from "@notnotype/nb-ui/text-port";

import {editorCatalogs} from "nbook/plugins/editor/web/text";
import {markdownCatalogs} from "nbook/plugins/markdown/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

const sceneLocale = (scene: string): DisplayLocale => (scene === "english" ? "en-US" : "zh-CN");

/** 按场景 id 建端口并注入给后代组件；返回端口，夹具自己要取文字时用同一个。 */
export function provideEditorText(scene: string): TextPort {
    const engine = createHostTextEngine({locale: sceneLocale(scene)});
    engine.register("nbook.editor", editorCatalogs.catalogs, editorCatalogs.source);
    engine.register("nbook.markdown", markdownCatalogs.catalogs, markdownCatalogs.source);
    provideHostText(engine.port);
    return engine.port;
}
