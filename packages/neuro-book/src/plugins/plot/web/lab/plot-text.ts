/**
 * 剧情各组件的夹具共用：注入登记了 `nbook.plot` 与 `nbook.canon` 目录的翻译端口（剧情的组件也用 canon 的位置说法），做法同
 * `canon-text.ts`。场景 id 以 `-english` 结尾的用英文界面。在夹具的 setup 里调用。
 */
import {canonCatalogs} from "nbook/plugins/canon/web/text";
import {plotCatalogs} from "nbook/plugins/plot/web/text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

export function providePlotText(scene: string): void {
    const engine = createHostTextEngine({locale: scene.endsWith("-english") ? "en-US" : "zh-CN"});
    engine.register("nbook.canon", canonCatalogs.catalogs, canonCatalogs.source);
    engine.register("nbook.plot", plotCatalogs.catalogs, plotCatalogs.source);
    provideHostText(engine.port);
}
