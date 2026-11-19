/**
 * canon 各组件的夹具共用：注入登记了 `nbook.canon` 目录的翻译端口（Lab 窗口的端口没有它，做法同 `explorer-scene/explorer-text.ts`）。
 * 场景 id 以 `-english` 结尾的用英文界面。在夹具的 setup 里调用。
 */
import {canonCatalogs} from "nbook/plugins/canon/web/text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

export function provideCanonText(scene: string): void {
    const engine = createHostTextEngine({locale: scene.endsWith("-english") ? "en-US" : "zh-CN"});
    engine.register("nbook.canon", canonCatalogs.catalogs, canonCatalogs.source);
    provideHostText(engine.port);
}
