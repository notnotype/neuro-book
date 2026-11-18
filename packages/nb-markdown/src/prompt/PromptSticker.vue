<script setup lang="ts">
/** 已发送文字里的一个表情（同名 .md）：用展示器的 `buildSticker` 画，元素与类名相同。 */
import {onBeforeUnmount, onMounted, ref, watch} from "vue";

import {useMarkdownHost} from "../host";
import {buildSticker} from "../language/syntax/sticker/view";
import type {StickerElement} from "../language/syntax/sticker/view";

const props = withDefaults(defineProps<{raw: string; gap?: string}>(), {gap: ""});

const host = useMarkdownHost();
const holder = ref<HTMLElement | null>(null);
let element: StickerElement | null = null;

function render(): void {
    element?.destroy();
    element = buildSticker(document, props.raw, host.stickers, (error) => host.report("markdown.sticker.resolve-failed", "resolving a sticker failed", error));
    for (const name of props.gap.split(" ")) if (name !== "") element.dom.classList.add(name);
    holder.value?.replaceChildren(element.dom);
}

onMounted(render);
watch(() => [props.raw, props.gap], render);
onBeforeUnmount(() => {
    element?.destroy();
    element = null;
});
</script>

<template>
    <span ref="holder" class="prompt-sticker" data-prompt-sticker />
</template>
