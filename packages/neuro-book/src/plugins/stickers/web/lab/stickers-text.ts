/**
 * 表情包页夹具的翻译端口：Lab 窗口的端口不登记本插件的目录，所以夹具另建一个宿主引擎、登记 `nbook.stickers` 的目录，只注入给场景里的零件
 * （做法同 `agent/web/lab/agent-page-text.ts`）。场景 id 是 `english` 或以 `-english` 结尾的用英文界面。
 */

import {defineComponent, h} from "vue";
import type {Component, PropType} from "vue";

import {stickersCatalogs} from "nbook/plugins/stickers/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {type LabSceneInput} from "nbook/plugins/lab/web/scene-kit";

const sceneLocale = (scene: string): DisplayLocale => (/(?:^|-)english$/u.test(scene) ? "en-US" : "zh-CN");

/** 给一个接 `scene` 与 `input` 的夹具组件套上本插件的翻译端口。 */
export function withStickersPageText(fixture: Component): Component {
    return defineComponent({
        name: "StickersPageTextFixture",
        props: {
            scene: {type: String, required: true},
            input: {type: Object as PropType<LabSceneInput>, default: undefined},
        },
        setup(props) {
            const engine = createHostTextEngine({locale: sceneLocale(props.scene)});
            engine.register("nbook.stickers", stickersCatalogs.catalogs, stickersCatalogs.source);
            provideHostText(engine.port);
            return () => h(fixture, {scene: props.scene, input: props.input});
        },
    });
}
