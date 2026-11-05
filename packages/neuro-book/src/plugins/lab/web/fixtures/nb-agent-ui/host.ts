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
import {createAgentViewRegistry} from "@notnotype/nb-agent-ui";
import type {AgentConversationServices, AgentViewRegistry} from "@notnotype/nb-agent-ui";
import * as nbAgentUiLab from "@notnotype/nb-agent-ui/lab";
import {builtinContributions} from "@notnotype/nb-agent-ui/vue";
import type {AgentViewRenderers} from "@notnotype/nb-agent-ui/vue";
import type {Component} from "vue";
import {defineComponent, h} from "vue";

import {MarkdownDisplay} from "@notnotype/nb-markdown/display";
import {provideMarkdownHost} from "@notnotype/nb-markdown/host";
import {PromptEditor, PromptTextView} from "@notnotype/nb-markdown/prompt";

import {nbookMarkdownHost} from "nbook/plugins/markdown/web/host";

import {provideAgentSceneText} from "./agent-text";
import {labAttachmentUrls} from "./data";
import {labDomainToolsContribution} from "./domain-tools";

export const labAgentRenderers: AgentViewRenderers = {form: AgentFormRenderer, markdown: MarkdownDisplay, promptEditor: PromptEditor, promptTextView: PromptTextView};

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

/** 内置登记（四份一次拿全）加 NeuroBook 的领域工具。 */
export function labAgentRegistry(): AgentViewRegistry {
    return createAgentViewRegistry([...builtinContributions, labDomainToolsContribution]);
}
