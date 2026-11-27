<script setup lang="ts">
/**
 * MarkdownDisplay 的场景（docs/specs/ui/markdown-display.md 验收场景 1、2、3）：`streaming` 场景按定时把场景的原文一段段追加，
 * 播完去掉光标；`conversation` 场景把场景的原文摆成 100 条消息，拖 Lab 画布改宽度，用来看长对话改宽度时的卡顿。表情三个场景用
 * Lab 的表情目录（`lab-stickers.ts`），`stickers-late` 的目录 1.5 秒后才给结果，`stickers-display` 把这个包设成按贴纸显示。
 */
import {Button} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, watch} from "vue";

import {MarkdownDisplay} from "@notnotype/nb-markdown/display";
import type {ResolveAsset} from "@notnotype/nb-markdown/display";
import {provideMarkdownHost} from "@notnotype/nb-markdown/host";

import {nbookMarkdownHost} from "nbook/plugins/markdown/web/host";

import {useLabEventSink} from "../lab-event-sink";
import {mountStickerDisplayStyle} from "nbook/plugins/stickers/web/display-style";

import {LAB_STICKER_PACK, labStickers} from "../../../stickers/web/lab/lab-stickers";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof MarkdownDisplay>(() => props.input);
const events = useLabEventSink();

// nbook 的宿主，只有内置方言：外来方言的组成由 `late-dialect.dom.test.ts` 验。
provideMarkdownHost(nbookMarkdownHost({stickers: labStickers(props.scene === "stickers-late" ? 1500 : 0)}));

// `stickers-display` 场景：Lab 的表情包按贴纸显示（stickers.md 输出 47），夹在文字里的也是大图。换场景、卸载时撤掉样式。
watch(() => props.scene, (scene, _previous, onCleanup) => {
    if (scene !== "stickers-display") return;
    // 自己的一份（owner `lab`）：不覆盖、不删掉 `nbook.stickers` 入口按真实偏好挂的那份。
    onCleanup(mountStickerDisplayStyle([LAB_STICKER_PACK], "lab"));
}, {immediate: true});

const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><rect width="640" height="240" fill="#7287fd"/><text x="320" y="132" font-size="32" text-anchor="middle" fill="white">示意图</text></svg>')}`;
const resolveAsset: ResolveAsset = () => Promise.resolve({url: PICTURE, release: () => undefined});

const full = computed(() => String(subject.bindings.value.text ?? ""));

/** 流式：每 40 毫秒追加 6 个字，模拟模型一边生成一边显示。 */
const played = ref("");
const playing = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;
const stop = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    playing.value = false;
};
const play = (): void => {
    stop();
    played.value = "";
    playing.value = true;
    timer = setInterval(() => {
        played.value = full.value.slice(0, played.value.length + 6);
        if (played.value.length >= full.value.length) stop();
    }, 40);
};
watch([() => props.scene, full], () => (props.scene === "streaming" ? play() : stop()), {immediate: true});
onBeforeUnmount(stop);

const MESSAGES = 100;
const conversation = computed(() => Array.from({length: MESSAGES}, (_, index) => `**第 ${String(index + 1)} 条**\n\n${full.value}`));
</script>

<template>
    <div v-if="props.scene === 'streaming'" class="h-full w-full overflow-auto p-4">
        <MarkdownDisplay data-lab-subject v-bind="subject.bindings.value" :text="played" :streaming="playing" :resolve-asset="resolveAsset" @activate="(activation) => events('activate', activation)" />
        <LabFixtureControls>
            <Button variant="primary" size="sm" @click="play">重播</Button>
        </LabFixtureControls>
    </div>
    <!-- 长对话：拖 Lab 画布的宽度改宽度。 -->
    <div v-else-if="props.scene === 'conversation'" class="h-full w-full overflow-auto p-4">
        <div class="flex w-full flex-col gap-4">
            <MarkdownDisplay v-for="(text, index) in conversation" :key="index" v-bind="index === 0 ? {'data-lab-subject': ''} : {}" :text="text" :locale="subject.bindings.value.locale" :resolve-asset="resolveAsset" @activate="(activation) => events('activate', activation)" />
        </div>
    </div>
    <div v-else class="h-full w-full overflow-auto p-4">
        <MarkdownDisplay data-lab-subject v-bind="subject.bindings.value" :resolve-asset="resolveAsset" @activate="(activation) => events('activate', activation)" />
    </div>
</template>
