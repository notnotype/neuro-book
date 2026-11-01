/**
 * 模型服务夹具的翻译端口：Lab 窗口的端口不登记本插件的目录，所以夹具另建一个宿主引擎、登记 `nbook.models` 的目录，只注入给
 * 场景里的零件（做法同 `projects-scene/projects-text.ts`）。场景 id 是 `english` 或以 `-english` 结尾的用英文界面。
 */

import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";
import {defineComponent, h, provide} from "vue";
import type {Component, PropType} from "vue";

import {modelsCatalogs} from "nbook/plugins/models/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {LabSceneInput} from "../../lab-subject";

const sceneLocale = (scene: string): DisplayLocale => (/(?:^|-)english$/u.test(scene) ? "en-US" : "zh-CN");

export function provideModelsText(scene: string): void {
    const engine = createHostTextEngine({locale: sceneLocale(scene)});
    engine.register("nbook.models", modelsCatalogs.catalogs, modelsCatalogs.source);
    provide(TEXT_PORT_KEY, engine.port);
}

/** 给一个接 `scene` 与 `input` 的夹具组件套上本插件的翻译端口。 */
export function withModelsText(fixture: Component): Component {
    return defineComponent({
        name: "ModelsTextFixture",
        props: {
            scene: {type: String, required: true},
            input: {type: Object as PropType<LabSceneInput>, default: undefined},
        },
        setup(props) {
            provideModelsText(props.scene);
            return () => h(fixture, {scene: props.scene, input: props.input});
        },
    });
}
