<script setup lang="ts">
/**
 * 表情选择器面板的台子（docs/specs/agent/stickers.md 输出 39 到 43）：用 Lab 的样本表情包造一个真的选择器服务（`createStickerPicker`），
 * 面板套在浮层的外框里。场景：`packs`（几个表情包）、`recent`（有最近用过）、`empty`（一个表情包也没有）、`narrow`（窄窗口）、`english`。
 */
import {onBeforeUnmount, shallowRef} from "vue";
import type {Component} from "vue";

import type {BrowserStickerPack} from "nbook/plugins/stickers/shared/contracts";
import {createStickerPicker} from "nbook/plugins/stickers/web/picker-service";
import {memoryRecent} from "nbook/plugins/stickers/web/recent";
import {createStickerDirectory} from "nbook/plugins/stickers/web/resolver";

import {detailOf, SAMPLES} from "./samples";

const props = defineProps<{scene: string}>();

const packs: BrowserStickerPack[] = props.scene === "empty" ? [] : SAMPLES.filter((sample) => (sample.status ?? "ok") === "ok" && sample.id !== "user.many").map((sample) => {
    const detail = detailOf(sample);
    return {
        id: sample.id, folder: sample.folder, title: sample.title, source: sample.source, ...(sample.plugin === undefined ? {} : {plugin: sample.plugin}), writing: sample.writing ?? sample.folder,
        stickers: detail.stickers.map((sticker) => ({name: sticker.name, width: sticker.width, height: sticker.height, url: sticker.url})),
    };
}).filter((pack) => pack.stickers.length > 0);

const directory = createStickerDirectory();
directory.set(packs);
const controller = new AbortController();
onBeforeUnmount(() => controller.abort());
const picker = createStickerPicker({directory, recent: memoryRecent(), openPacksPage: () => undefined, report: () => undefined, signal: controller.signal});
if (props.scene === "recent") {
    for (const raw of [":mochi/好耶:", ":lyra/开心:"]) {
        const found = picker.groups().flatMap((group) => group.items).find((item) => item.raw === raw);
        if (found !== undefined) picker.used(found);
    }
}
const panel = shallowRef<Component | null>(null);
void picker.loadPanel().then((loaded) => {
    panel.value = loaded;
});
</script>

<template>
    <div class="sticker-picker-fixture nb-ui-popover-surface" :class="{'is-narrow': scene === 'narrow'}" data-lab-subject>
        <component :is="panel" v-if="panel !== null" />
    </div>
</template>

<style scoped>
.sticker-picker-fixture {
    display: inline-flex;
    max-width: 100%;
    padding: 0;
}

.sticker-picker-fixture.is-narrow {
    width: 300px;
}
</style>
