/**
 * Agent 设置页夹具的翻译端口：Lab 窗口的端口不登记本插件的目录，所以夹具另建一个宿主引擎、登记 `nbook.agent` 的目录，只注入给
 * 场景里的零件（做法同 `projects-scene/projects-text.ts`）。场景 id 是 `english` 或以 `-english` 结尾的用英文界面。
 */

import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";
import {defineComponent, h, provide} from "vue";
import type {Component, PropType} from "vue";

import {agentCatalogs} from "nbook/plugins/agent/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {LabSceneInput} from "../../lab-subject";

const sceneLocale = (scene: string): DisplayLocale => (/(?:^|-)english$/u.test(scene) ? "en-US" : "zh-CN");

export function provideAgentPageText(scene: string): void {
    const engine = createHostTextEngine({locale: sceneLocale(scene)});
    engine.register("nbook.agent", agentCatalogs.catalogs, agentCatalogs.source);
    provide(TEXT_PORT_KEY, engine.port);
}

/** 给一个接 `scene` 与 `input` 的夹具组件套上本插件的翻译端口。 */
export function withAgentPageText(fixture: Component): Component {
    return defineComponent({
        name: "AgentPageTextFixture",
        props: {
            scene: {type: String, required: true},
            input: {type: Object as PropType<LabSceneInput>, default: undefined},
        },
        setup(props) {
            provideAgentPageText(props.scene);
            return () => h(fixture, {scene: props.scene, input: props.input});
        },
    });
}
