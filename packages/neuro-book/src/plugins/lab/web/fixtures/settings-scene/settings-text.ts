/**
 * 设置零件夹具的翻译端口：Lab 窗口的端口不登记 `nbook.settings` 的目录，所以夹具另建一个宿主引擎、登记它，只注入给场景里的
 * 零件（做法同 `explorer/web/lab/explorer-text.ts`）。场景 id 是 `english` 或以 `-english` 结尾的用英文界面，其余用中文；
 * 这些零件没有 `locale` 属性，语言只由场景决定。设置窗口的场景不用这里：它的端口由局部宿主给（`settings-host.ts` 的 `text`）。
 */

import type {TextPort} from "@notnotype/nb-ui/text-port";
import {defineComponent, h} from "vue";
import type {Component, PropType} from "vue";

import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {LabSceneInput} from "../../lab-subject";

export const settingsSceneLocale = (scene: string): DisplayLocale => (/(?:^|-)english$/u.test(scene) ? "en-US" : "zh-CN");

/** 按场景 id 建端口并注入给后代组件；返回端口，夹具自己要取文字时用同一个。 */
export function provideSettingsText(scene: string): TextPort {
    const engine = createHostTextEngine({locale: settingsSceneLocale(scene)});
    engine.register("nbook.settings", settingsCatalogs.catalogs, settingsCatalogs.source);
    provideHostText(engine.port);
    return engine.port;
}

/** 给一个接 `scene` 与 `input` 的夹具组件套上设置的翻译端口。 */
export function withSettingsText(fixture: Component): Component {
    return defineComponent({
        name: "SettingsTextFixture",
        props: {
            scene: {type: String, required: true},
            input: {type: Object as PropType<LabSceneInput>, default: undefined},
        },
        setup(props) {
            provideSettingsText(props.scene);
            return () => h(fixture, {scene: props.scene, input: props.input});
        },
    });
}
