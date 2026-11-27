<script setup lang="ts">
/**
 * ImageViewer 的 Lab 场景（docs/specs/workbench/image-viewer.md，同名 .md）：字节绑定由夹具给出，图片在浏览器里用 canvas
 * 生成（同源的 blob 地址，与产品里同源的字节地址一样能 `fetch`）。场景 `large` 是比舞台大的图（适应与滚动），`svg` 带透明
 * 部分（棋盘格），`broken` 不是图片。“外部改写”换一张图并让 `version` 加一，与产品里文件变化时一样。
 * 控件的文字经翻译端口取，Lab 窗口的端口不登记本插件的目录，所以这里另建一个宿主引擎注入；语言取场景输入的 `locale`，
 * 控件的 `locale`（只管大小的数字格式）也用它。
 */
import {computed, onBeforeUnmount, ref, shallowRef, watch} from "vue";

import type {BytesEditorBinding, ViewStateSlot} from "nbook/plugins/editor/shared/contracts";
import ImageViewer from "nbook/plugins/image-viewer/web/components/ImageViewer.vue";
import {imageViewerCatalogs} from "nbook/plugins/image-viewer/web/text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {LabFixtureControls, useLabEventSink, type LabFixtureProps} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
const locale = computed((): DisplayLocale => (props.input?.props?.locale === "en-US" ? "en-US" : "zh-CN"));
const text = createHostTextEngine({locale: locale.value});
text.register("nbook.image-viewer", imageViewerCatalogs.catalogs, imageViewerCatalogs.source);
provideHostText(text.port);
watch(locale, (next) => text.setLocale(next));
const label = computed(() => (typeof props.input?.props?.label === "string" ? props.input.props.label : "插图.png"));

const urls: string[] = [];
const remember = (url: string): string => {
    urls.push(url);
    return url;
};

/** 一张画了渐变与文字的 PNG；`round` 换一种配色，模拟外部改写。 */
const png = async (width: number, height: number, round: number): Promise<string> => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("没有 2d 画布");
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, round % 2 === 0 ? "#3b82f6" : "#f97316");
    gradient.addColorStop(1, round % 2 === 0 ? "#a855f7" : "#22c55e");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = "rgba(255,255,255,0.9)";
    context.font = `${String(Math.round(height / 8))}px sans-serif`;
    context.fillText(`${String(width)} × ${String(height)} · 第 ${String(round + 1)} 版`, width / 12, height / 2);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value === null ? reject(new Error("toBlob 失败")) : resolve(value)), "image/png"));
    return remember(URL.createObjectURL(blob));
};

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><circle cx="100" cy="100" r="80" fill="#ef4444" fill-opacity="0.85"/><rect x="150" y="40" width="140" height="120" rx="16" fill="#0ea5e9" fill-opacity="0.6"/></svg>`;

const source = async (scene: string, round: number): Promise<string> => {
    if (scene === "svg") return remember(URL.createObjectURL(new Blob([SVG], {type: "image/svg+xml"})));
    if (scene === "broken") return remember(URL.createObjectURL(new Blob(["这不是图片"], {type: "text/plain"})));
    return scene === "large" ? png(2400, 1600, round) : png(480, 300, round);
};

const url = ref<string | null>(null);
const version = ref(0);
const round = ref(0);
const slot: ViewStateSlot = {state: null, dispose: null};
const binding = shallowRef<BytesEditorBinding | null>(null);

watch(() => props.scene, async (scene) => {
    round.value = 0;
    url.value = await source(scene, 0);
    binding.value = {kind: "bytes", token: `lab-${scene}`, tabId: "lab-tab", editor: "nbook.image-viewer.image", address: computed(() => `project://插图/${label.value}`), url, version, slot};
}, {immediate: true});

const rewrite = async (): Promise<void> => {
    round.value += 1;
    url.value = await source(props.scene, round.value);
    version.value += 1;
    record("rewrite", round.value);
};

onBeforeUnmount(() => {
    for (const each of urls) URL.revokeObjectURL(each);
});
</script>

<template>
    <ImageViewer
        v-if="binding !== null"
        class="h-full w-full"
        data-lab-subject
        :binding="binding"
        :host="slot"
        :readonly="true"
        :visible="true"
        :label="label"
        :locale="locale"
        @ready="(handle) => record('ready', handle === null ? null : 'handle')"
        @focus="(focused) => record('focus', focused)"
    />
    <LabFixtureControls>
        <div class="flex items-center gap-3 text-xs" data-lab-image-controls>
            <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" data-lab-image-rewrite @click="rewrite">外部改写</button>
        </div>
    </LabFixtureControls>
</template>
