<script lang="ts">
/**
 * nbook 交出的 nb-markdown 组件的外层（同名 .md）：给子树提供 nbook 的宿主（作品文件的目标分类、文件图标、诊断，展示器另有
 * 方言目录组成的语言），再按 `component` 挂对应的包组件，其余属性、事件与插槽原样转过去，外露方法经 `forwardExpose` 转出。
 *
 * 宿主接线放在这个按需加载的组件里，插件入口只按 `.vue` 引它：后端类型检查对 `.vue` 只看通配声明，不展开包源码里的 DOM 类型；
 * 首屏也不带包。
 *
 * 包组件的异步包装在模块里建一次，所有实例共用：长对话里每条消息一个展示器，第一个加载完后其余的同步挂上。
 */
import {defineAsyncComponent, ref} from "vue";
import type {Component} from "vue";

import type {languageFor as LanguageFor} from "../language-registry";

export type HostedComponent = "MarkdownDisplay" | "MarkdownImage" | "InlineChip" | "PromptEditor" | "PromptTextView";

/** 展示器的加载连同组语言的模块一起等：展示器挂上时取语言，此时它已经到了。别的组件不带语言。 */
let languageOf: typeof LanguageFor | null = null;

const LOADERS: Readonly<Record<HostedComponent, () => Promise<Component>>> = {
    MarkdownDisplay: async () => {
        const [display, registry] = await Promise.all([import("@notnotype/nb-markdown/display"), import("../language-registry")]);
        languageOf = registry.languageFor;
        return display.MarkdownDisplay;
    },
    MarkdownImage: async () => (await import("@notnotype/nb-markdown/display")).MarkdownImage,
    InlineChip: async () => (await import("@notnotype/nb-markdown/chip")).InlineChip,
    PromptEditor: async () => (await import("@notnotype/nb-markdown/prompt")).PromptEditor,
    PromptTextView: async () => (await import("@notnotype/nb-markdown/prompt")).PromptTextView,
};

/** 加载失败（部署换了版本、网络断了）的组件；展示器按纯文字显示原文（docs/specs/ui/markdown-display.md 的“失败与恢复”）。 */
const failed = ref<ReadonlySet<HostedComponent>>(new Set());
let reportFailure: ((component: HostedComponent, error: unknown) => void) | null = null;

const INNER = Object.fromEntries(Object.entries(LOADERS).map(([name, load]) => [name, defineAsyncComponent(() => load().catch((error: unknown) => {
    failed.value = new Set([...failed.value, name as HostedComponent]);
    reportFailure?.(name as HostedComponent, error);
    throw error;
}))])) as Readonly<Record<HostedComponent, Component>>;
</script>

<script setup lang="ts">
import {computed, inject, shallowRef} from "vue";

import {provideMarkdownHost} from "@notnotype/nb-markdown/host";

import {NBOOK_IMAGE_MISSING, nbookChips, nbookMarkdownHost} from "../host";
import {exposeOf} from "../parts/forward-expose";
import {markdownReportKey} from "../parts/report";
import {markdownStickersKey} from "../parts/stickers";
import {syntaxCatalogKey} from "../syntax-catalog";

defineOptions({inheritAttrs: false});
const props = defineProps<{component: HostedComponent}>();

const catalog = inject(syntaxCatalogKey, null);
const report = inject(markdownReportKey, () => undefined);
// 加载失败是模块级的一次性事件，记到最近挂上的实例拿到的诊断出口（同一个插件给的都是同一个）。
reportFailure = (component, error) => report("markdown.component.load-failed", `${component} 的代码加载失败`, error);

provideMarkdownHost(nbookMarkdownHost({
    // 只有展示器取语言；它在加载完（`languageOf` 有了）之后才挂上，所以这里的 null 只在加载失败时出现，那时展示器不会挂上。
    ...(props.component === "MarkdownDisplay" ? {language: () => {
        if (languageOf === null) throw new Error("MarkdownHosted：展示器挂上时组语言的模块还没加载");
        return languageOf(catalog);
    }} : {}),
    report,
    stickers: inject(markdownStickersKey, null),
}));

/** 宿主信息只收属性、不读 `provideMarkdownHost` 的两个组件：小块的分类与图标经 `env`，图片的说明经 `missing`（文字两者都经窗口注入的翻译端口）。 */
const EXTRA: Readonly<Partial<Record<HostedComponent, Record<string, unknown>>>> = {
    InlineChip: {env: nbookChips},
    MarkdownImage: {missing: NBOOK_IMAGE_MISSING},
};
const extra = EXTRA[props.component] ?? {};
const inner = INNER[props.component];
const isFailed = computed(() => failed.value.has(props.component));

const exposed = shallowRef<Record<PropertyKey, unknown> | null>(null);
defineExpose(exposeOf(exposed));
</script>

<template>
    <div v-if="isFailed && props.component === 'MarkdownDisplay'" class="nb-markdown-display" style="white-space: pre-wrap">{{ $attrs.text }}</div>
    <component :is="inner" v-else ref="exposed" v-bind="{...extra, ...$attrs}">
        <template v-for="(_, name) in $slots" #[name]="scope">
            <slot :name="name" v-bind="scope ?? {}" />
        </template>
    </component>
</template>
