<script setup lang="ts">
/**
 * HtmlPreview 的 Lab 场景（docs/specs/workbench/html-preview.md，同名 .md）：文本绑定与令牌服务由夹具给出。Lab 没有服务端，
 * 令牌的 `base` 指向一个不存在的前缀：页面里的内联样式与脚本照常运行，相对引用读不到（产品里由 `e2e/editor-types.e2e.ts`
 * 验收）。场景 `user` 是 `user://` 下的文件，`denied` 是令牌申请失败。控件里的“改正文”模拟在源码标签输入。
 * 控件的文字经翻译端口取，Lab 窗口的端口不登记本插件的目录，所以这里另建一个宿主引擎注入；场景 id 是 `english` 或以
 * `-english` 结尾的用英文界面，其余用中文。
 */
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {computed, ref, shallowRef, watch} from "vue";

import type {TextEditorBinding, ViewStateSlot} from "nbook/plugins/editor/shared/contracts";
import HtmlPreview from "nbook/plugins/html-preview/web/components/HtmlPreview.vue";
import type {PreviewAccess} from "nbook/plugins/html-preview/web/access";
import {htmlPreviewCatalogs} from "nbook/plugins/html-preview/web/text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {LabFixtureControls, useLabEventSink, type LabFixtureProps} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
const sceneLocale = (scene: string): string => (/(?:^|-)english$/u.test(scene) ? "en-US" : "zh-CN");
const textEngine = createHostTextEngine({locale: sceneLocale(props.scene)});
textEngine.register("nbook.html-preview", htmlPreviewCatalogs.catalogs, htmlPreviewCatalogs.source);
provideHostText(textEngine.port);
watch(() => props.scene, (scene) => textEngine.setLocale(sceneLocale(scene)));

const page = (count: number): string => `<!doctype html><html><head><style>body{font:16px/1.6 sans-serif;margin:32px;color:#1f2937}h1{color:#7c3aed}button{font:inherit;padding:4px 12px}</style></head><body><h1>预览里的页面</h1><p>第 ${String(count)} 版。下面的按钮由页面自己的脚本处理：</p><button id="b">点了 0 次</button><p><a href="#end">跳到末尾</a></p><div style="height:900px"></div><p id="end">末尾</p><script>var n=0;document.getElementById("b").onclick=function(){n+=1;this.textContent="点了 "+n+" 次";};<\/script></body></html>`;

const text = ref(page(1));
const revision = ref(1);
const version = ref(1);
const slot: ViewStateSlot = {state: null, dispose: null};
const binding = shallowRef<TextEditorBinding | null>(null);

const access = computed((): PreviewAccess => ({
    open: async () => (props.scene.startsWith("denied") ? {ok: false, denial: "closed"} : {ok: true, token: "lab", base: `${globalThis.location.origin}/__lab-preview/lab/`}),
    close: (token) => record("close", token),
}));

watch(() => props.scene, (scene) => {
    const address = scene === "user" ? "user://notes/page.html" : "project://site/index.html";
    binding.value = {kind: "text", token: `lab-${scene}`, tabId: "lab-tab", editor: "nbook.html-preview.html", address: computed(() => address), text, revision, slot, commit: () => ({status: "stale"}), attach: () => () => undefined, unresolved: () => false, block: () => undefined, blocked: () => false, cursor: null, remember: () => undefined, language: computed(() => null)};
}, {immediate: true});

const edit = (): void => {
    version.value += 1;
    text.value = page(version.value);
    revision.value += 1;
    record("edit", version.value);
};
</script>

<template>
    <HtmlPreview
        v-if="binding !== null"
        class="h-full w-full"
        data-lab-subject
        :binding="binding"
        :host="slot"
        :readonly="true"
        :visible="true"
        label="index.html"
        :access="access"
        :clock="systemClock"
        :network="() => false"
        @ready="(handle) => record('ready', handle === null ? null : 'handle')"
    />
    <LabFixtureControls>
        <div class="flex items-center gap-3 text-xs" data-lab-preview-controls>
            <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" data-lab-preview-edit @click="edit">改正文</button>
        </div>
    </LabFixtureControls>
</template>
