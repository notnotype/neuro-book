/**
 * 工作台零件夹具的翻译端口：Lab 窗口的端口不登记 `nbook.workbench` 的目录，所以夹具另建一个宿主引擎、登记它，只注入给场景里
 * 的零件（做法同 `settings-scene/settings-text.ts`）。场景 id 是 `english` 或以 `-english` 结尾的用英文界面，其余用中文；
 * 个别场景在改成端口之前就用英文且 id 被 e2e 引用，改 id 会断，由夹具用 `englishScenes` 点名。这些零件没有 `locale` 属性，
 * 语言只由场景决定。
 */

import type {TextPort} from "@notnotype/nb-ui/text-port";
import {defineComponent, h} from "vue";
import type {Component, PropType} from "vue";

import {workbenchCatalogs} from "nbook/plugins/workbench/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {type LabSceneInput} from "nbook/plugins/lab/web/scene-kit";

/** 场景的界面语言。 */
export function workbenchSceneLocale(scene: string, englishScenes: ReadonlyArray<string> = []): DisplayLocale {
    return /(?:^|-)english$/u.test(scene) || englishScenes.includes(scene) ? "en-US" : "zh-CN";
}

/** 按语言建端口并注入给后代组件；返回端口，夹具自己要取文字时用同一个。 */
export function provideWorkbenchText(locale: DisplayLocale): TextPort {
    const engine = createHostTextEngine({locale});
    engine.register("nbook.workbench", workbenchCatalogs.catalogs, workbenchCatalogs.source);
    provideHostText(engine.port);
    return engine.port;
}

/** 给一个接 `scene` 与 `input` 的夹具组件套上工作台的翻译端口。 */
export function withWorkbenchText(fixture: Component, englishScenes: ReadonlyArray<string> = []): Component {
    return defineComponent({
        name: "WorkbenchTextFixture",
        props: {
            scene: {type: String, required: true},
            input: {type: Object as PropType<LabSceneInput>, default: undefined},
        },
        setup(props) {
            provideWorkbenchText(workbenchSceneLocale(props.scene, englishScenes));
            return () => h(fixture, {scene: props.scene, input: props.input});
        },
    });
}
