/**
 * 项目插件夹具的翻译端口：Lab 窗口的端口不登记本插件的目录，所以夹具另建一个宿主引擎、登记 `nbook.projects` 的目录，
 * 只注入给场景里的零件（做法同 `explorer/web/lab/explorer-text.ts`）。场景 id 是 `english` 或以 `-english` 结尾的用英文
 * 界面，其余用中文；这些组件没有 `locale` 属性，语言只由场景决定。
 */

import type {TextPort} from "@notnotype/nb-ui/text-port";
import {defineComponent, h} from "vue";
import type {Component, PropType} from "vue";

import {projectsCatalogs} from "nbook/plugins/projects/web/text";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {type LabSceneInput} from "nbook/plugins/lab/web/scene-kit";

const sceneLocale = (scene: string): DisplayLocale => (/(?:^|-)english$/u.test(scene) ? "en-US" : "zh-CN");

/** 按场景 id 建端口并注入给后代组件；返回端口，夹具自己要取文字时用同一个。 */
export function provideProjectsText(scene: string): TextPort {
    const engine = createHostTextEngine({locale: sceneLocale(scene)});
    engine.register("nbook.projects", projectsCatalogs.catalogs, projectsCatalogs.source);
    // “作品”设置页里的设置行（`SettingsRow`）用设置插件的文字。
    engine.register("nbook.settings", settingsCatalogs.catalogs, settingsCatalogs.source);
    provideHostText(engine.port);
    return engine.port;
}

/** 给一个接 `scene` 与 `input` 的夹具组件套上本插件的翻译端口。 */
export function withProjectsText(fixture: Component): Component {
    return defineComponent({
        name: "ProjectsTextFixture",
        props: {
            scene: {type: String, required: true},
            input: {type: Object as PropType<LabSceneInput>, default: undefined},
        },
        setup(props) {
            provideProjectsText(props.scene);
            return () => h(fixture, {scene: props.scene, input: props.input});
        },
    });
}
