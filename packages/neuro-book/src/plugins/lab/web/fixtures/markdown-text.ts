/**
 * 单独挂 nb-markdown 组件的场景的翻译端口（docs/specs/ui/i18n.md）。组件读注入的端口，Lab 窗口的端口跟着窗口的语言走、也不登记
 * `nbook.markdown` 的目录（图片的“不在作品里”是它的键），所以夹具另建一个宿主引擎（`createHostTextEngine` 登记了
 * nb-markdown 的目录）、登记 `nbook.markdown`，只注入给场景里的组件。做法同 `explorer/web/lab/explorer-text.ts`。
 *
 * 场景语言：场景 id 是 `english` 或以 `-english` 结尾的、或场景输入的 `locale` 是 `en-US` 的用英文，其余中文。后一条给还留着
 * `locale` 属性的根组件（`MarkdownDisplay`、`PromptEditor`、`PromptTextView`）：注入了端口时那个属性不起作用，夹具按它
 * 设端口的语言，场景与数据 tab 里写的语言照旧生效。
 */

import {defineComponent, h, watch} from "vue";
import type {Component, PropType} from "vue";

import {markdownCatalogs} from "nbook/plugins/markdown/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {LabSceneInput} from "../lab-subject";

/** 场景的界面语言。 */
export function markdownSceneLocale(scene: string, input: LabSceneInput | undefined): DisplayLocale {
    return /(?:^|-)english$/u.test(scene) || input?.props?.["locale"] === "en-US" ? "en-US" : "zh-CN";
}

/** 夹具在 `setup` 里调用：按场景语言建端口并注入给后代；语言变了（换场景输入）跟着换。 */
export function provideMarkdownSceneText(locale: () => DisplayLocale): void {
    const engine = createHostTextEngine({locale: locale()});
    engine.register("nbook.markdown", markdownCatalogs.catalogs, markdownCatalogs.source);
    provideHostText(engine.port);
    watch(locale, (next) => engine.setLocale(next));
}

/** 给一个接 `scene` 与 `input` 的夹具组件套上场景端口。 */
export function withMarkdownSceneText(fixture: Component): Component {
    return defineComponent({
        name: "MarkdownSceneTextFixture",
        props: {
            scene: {type: String, required: true},
            input: {type: Object as PropType<LabSceneInput>, default: undefined},
        },
        setup(props) {
            provideMarkdownSceneText(() => markdownSceneLocale(props.scene, props.input));
            return () => h(fixture, {scene: props.scene, input: props.input});
        },
    });
}
