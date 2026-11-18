<script setup lang="ts">
/** 编辑器里的表情选择器弹层（同名 .md）：外框是 `AnchoredPopover`，里面是表情包插件交出的面板。 */
import {AnchoredPopover} from "@notnotype/nb-ui/components";
import {inject, shallowRef, watch} from "vue";
import type {Component} from "vue";

import type {StickerPicker, StickerPickerItem} from "nbook/plugins/stickers/shared/contracts";

import {markdownReportKey} from "../../parts/report";
import type {PopoverAnchor} from "./selection-anchor";

const props = defineProps<{open: boolean; anchor: PopoverAnchor | null; picker: StickerPicker}>();
const emit = defineEmits<{(event: "pick", item: StickerPickerItem, keepOpen: boolean): void; (event: "close"): void}>();

const panel = shallowRef<Component | null>(null);
const report = inject(markdownReportKey, null);
/** 第一次打开时才加载面板的代码；加载失败（部署换了版本、网络断了）时记诊断并关上。 */
async function load(): Promise<void> {
    try {
        panel.value = await props.picker.loadPanel();
    } catch (error) {
        report?.("markdown.sticker-picker.load-failed", "loading the sticker picker failed", error);
        emit("close");
    }
}
watch(() => props.open, (open) => {
    if (open && panel.value === null) void load();
}, {immediate: true});
</script>

<template>
    <AnchoredPopover :open="props.open && panel !== null" :anchor="props.anchor" side="bottom" align="start">
        <div class="markdown-sticker-card" data-markdown-menu-layer data-markdown-sticker-card>
            <component :is="panel" @pick="(item: StickerPickerItem, keepOpen: boolean) => emit('pick', item, keepOpen)" @close="emit('close')" />
        </div>
    </AnchoredPopover>
</template>

<style scoped>
.markdown-sticker-card {
    display: flex;
    max-width: calc(100vw - 24px);
}
</style>
