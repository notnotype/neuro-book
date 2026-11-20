/**
 * nb-agent-ui 场景里的宿主：把 `nbook.markdown` 的 Markdown 显示、提示词编辑器与已发送文字的显示注入对话视图，
 * 与主应用以后的接法相同（docs/specs/ui/agent-conversation-view.md“Props 与事件”的 `renderers`）。
 *
 * Lab 只在开发模式加载，可以直接引用其它插件的 `web/` 组件（packages/neuro-book/AGENTS.md）；Markdown 显示要的方言目录
 * 照 `MarkdownDisplayFixture.vue` 给一份只有内置方言的。零件单独挂载时用 `withAgentHost` 包一层，组件的属性、事件与
 * 插槽原样转过去。
 *
 * 本文件静态引用了 Markdown 插件的组件，场景登记（`index.ts`）只能动态 import 它，选中场景时才加载。
 */

import AgentFormRenderer from "nbook/plugins/agent/web/form-renderer.vue";
import EvalDetail from "nbook/plugins/agent/web/components/EvalDetail.vue";
import {evalContribution} from "nbook/plugins/agent/web/eval-renderer";
import {createAgentViewRegistry} from "@notnotype/nb-agent-ui";
import type {AgentConversationServices, AgentViewRegistry} from "@notnotype/nb-agent-ui";
import * as nbAgentUiLab from "@notnotype/nb-agent-ui/lab";
import {builtinContributions} from "@notnotype/nb-agent-ui/vue";
import type {AgentViewRenderers} from "@notnotype/nb-agent-ui/vue";
import type {Component} from "vue";
import {defineComponent, h, onMounted, shallowRef} from "vue";

import {MarkdownDisplay} from "@notnotype/nb-markdown/display";
import {provideMarkdownHost} from "@notnotype/nb-markdown/host";
import {PromptEditor, PromptTextView} from "@notnotype/nb-markdown/prompt";

import {nbookMarkdownHost} from "nbook/plugins/markdown/web/host";
import {providerIcon} from "nbook/ui/provider-icons";

import {provideAgentSceneText} from "./agent-text";
import {labAttachmentUrls} from "./data";
import {labDomainToolsContribution, labStatusItemsContribution} from "./domain-tools";

/** Lab 里的图标解析端口：同应用，服务商图标按键取（表是动态导入的，晚到时首字母换成图标）。 */
const labIcons: NonNullable<AgentViewRenderers["icons"]> = (icon) => (icon.kind === "key" && icon.set === "provider" ? providerIcon(icon.key) : null);

export const labAgentRenderers: AgentViewRenderers = {icons: labIcons, form: AgentFormRenderer, markdown: MarkdownDisplay, promptEditor: PromptEditor, promptTextView: PromptTextView};

/**
 * 给对话视图的祖先提供 nbook 的 Markdown 宿主（作品文件的小块、文件图标；只有内置方言）；挂 `AgentConversationView` 的夹具
 * 也要调用。不提供时组件用 nb-markdown 的缺省宿主，作品文件的引用不是文件小块。
 */
export function provideLabMarkdown(): void {
    provideMarkdownHost(nbookMarkdownHost({}));
}

/** 单独挂载的零件：先交出方言目录、翻译端口与渲染组件，再渲染零件本身。 */
export function withAgentHost(inner: Component, options: {plain?: boolean} = {}): Component {
    return defineComponent({
        name: "LabAgentHost",
        inheritAttrs: false,
        setup: (_props, {attrs, slots}) => {
            provideLabAgentHost(options);
            return () => h(inner, attrs, slots);
        },
    });
}

/**
 * 模型选择器：面板锚在输入框那样的一块宽框上（缺省锚点是触发器，面板贴着触发器向两边展开、在窄画布里被裁掉），
 * 框放在画布底部，面板向上弹。
 */
export function rolePickerSubject(): {default: Component} {
    const Picker = nbAgentUiLab.AgentRoleModelPicker as Component;
    type Effort = {value: string | null; source: string | null; follow?: {source: string; value?: string | null} | null};
    const Framed = defineComponent({
        name: "LabRolePickerFrame",
        inheritAttrs: false,
        setup: (_props, {attrs}) => {
            const frame = shallowRef<HTMLElement | null>(null);
            const picker = shallowRef<{openPicker(search?: string): void} | null>(null);
            // 场景属性：`labOpen: "models"` 挂上后直接打开面板的模型库页（截图要点面板里的页签，而面板传送在舞台外，点不到）；
            // `labWidth` 是锚框的宽（面板同宽，窄屏与两列版式靠它）；`labLocale: "en-US"` 换成英文界面（英文比中文长一倍，截断只在英文里看得出）。
            const {labOpen, labWidth, labLocale, ...rest} = attrs as Record<string, unknown>;
            // 同一个 `setup` 里后调用的才覆盖祖先的端口，只给后代（选择器）英文的。
            if (labLocale === "en-US") provideAgentSceneText(() => "en-US");
            // 档位的写回在这里做：真实宿主选了档、点了“用默认”之后是服务端回写 `effort`，Lab 没有服务端，就地换成对应的视图，
            // 才看得到选中、继承与“用默认”的来回。`effort` 属性没变（换场景）时沿用，换了就以场景给的为准。
            const override = shallowRef<{from: unknown; effort: Effort} | null>(null);
            const shown = (): Effort | undefined => {
                const given = rest.effort as Effort | undefined;
                return override.value !== null && override.value.from === given ? override.value.effort : given;
            };
            const forward = (name: string, ...args: unknown[]): void => {
                const handler = rest[name];
                if (typeof handler === "function") (handler as (...values: unknown[]) => void)(...args);
            };
            const onSelectThinking = (level: string): void => {
                const current = shown();
                if (current !== undefined) override.value = {from: rest.effort, effort: {...current, value: level, source: "session"}};
                forward("onSelectThinking", level);
            };
            const onResetThinking = (): void => {
                const current = shown();
                if (current?.follow != null) override.value = {from: rest.effort, effort: {...current, value: current.follow.value ?? current.value, source: current.follow.source}};
                forward("onResetThinking");
            };
            onMounted(() => {
                if (labOpen === "models") picker.value?.openPicker(" ");
                else if (labOpen === "roles") picker.value?.openPicker();
            });
            return () => {
                const width = typeof labWidth === "number" ? labWidth : 420;
                return h("div", {ref: frame, style: `width: ${String(width)}px; margin-top: 460px; padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 12px; box-sizing: content-box;`}, [h(Picker, {...rest, effort: shown(), onSelectThinking, onResetThinking, ref: picker, anchor: frame.value})]);
            };
        },
    });
    return {default: withAgentHost(Framed)};
}

/** 按名字取 Lab 入口里的内部零件，包上 `withAgentHost`。 */
export function agentSubject(name: keyof typeof nbAgentUiLab, options: {plain?: boolean} = {}): {default: Component} {
    return {default: withAgentHost(nbAgentUiLab[name] as Component, options)};
}

/** 零件夹具在 setup 里调用：交出方言目录、中文的翻译端口（`agent-text.ts`）与 Lab 的渲染组件。 */
export function provideLabAgentHost(options: {plain?: boolean} = {}): void {
    provideLabMarkdown();
    provideAgentSceneText(() => "zh-CN");
    nbAgentUiLab.provideAgentView({renderers: () => (options.plain === true ? {} : labAgentRenderers)});
}

const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#7287fd"/><text x="320" y="132" font-size="32" text-anchor="middle" fill="white">示意图</text></svg>')}`;

/** Lab 的服务：附件地址查假数据表，回复里的 Markdown 图片一律换成一张示意图，触发菜单为空（输入框夹具另给）。 */
export function labAgentServices(): AgentConversationServices {
    return {
        resolveAttachmentUrl: (locator) => labAttachmentUrls[locator] ?? null,
        resolveTriggerMenu: () => ({items: []}),
        resolveMarkdownAsset: () => Promise.resolve({url: PICTURE, release: () => undefined}),
    };
}

/** 内置登记（四份一次拿全）加 NeuroBook 的领域工具，与 `nbook.agent` 登记的 eval 卡片（同产品宿主）。 */
export function labAgentRegistry(): AgentViewRegistry {
    return createAgentViewRegistry([...builtinContributions, labDomainToolsContribution, labStatusItemsContribution, evalContribution({detail: EvalDetail})]);
}
