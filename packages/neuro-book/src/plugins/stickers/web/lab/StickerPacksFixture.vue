<script setup lang="ts">
/**
 * 表情包页夹具：场景给页面的真实属性（概要、详情、上传），选包能点（详情从样本里取）；写入都“成功”但不留下改动（Lab 里不连服务）。
 * 场景名里的 `narrow` 把台子收窄到 480px，`english` 用英文界面。
 */
import {computed, ref} from "vue";

import type {StickerPackDetail, StickerPackSummary} from "nbook/plugins/stickers/shared/contracts";
import StickerPacksPage from "nbook/plugins/stickers/web/components/StickerPacksPage.vue";
import type {UploadItem} from "nbook/plugins/stickers/web/upload-queue";

import {type LabSceneInput} from "nbook/plugins/lab/web/scene-kit";
import {detailOf, sampleById} from "./samples";

const props = defineProps<{scene: string; input?: LabSceneInput}>();
const page = computed(() => (props.input?.props ?? {}) as {state: "loading" | "ready" | {failed: string}; packs: readonly StickerPackSummary[]; selected: string | null; detail: StickerPackDetail | null; uploads?: readonly UploadItem[]; initialSticker?: string | null});
const selected = ref<string | null>(page.value.selected);
/** 选了别的包就从样本里取它的详情；场景里的详情只管第一次（有的场景故意给 null：无效的包）。 */
const detail = computed(() => {
    if (selected.value === page.value.selected) return page.value.detail;
    const sample = selected.value === null ? undefined : sampleById(selected.value);
    return sample === undefined ? null : detailOf(sample);
});
const succeed = async () => null;
</script>

<template>
    <div class="stickers-fixture" :class="{'is-narrow': scene.includes('narrow')}" data-lab-subject>
        <StickerPacksPage
            :key="selected ?? ''"
            :state="page.state"
            :packs="page.packs"
            :selected="selected"
            :detail="detail"
            :uploads="page.uploads ?? []"
            :initial-sticker="selected === page.selected ? page.initialSticker ?? null : null"
            :create-pack="async (folder: string) => ({id: `user.${folder}`})"
            :rename-pack="async (_id: string, folder: string) => ({id: `user.${folder}`})"
            :copy-pack="async () => ({id: 'user.mochi-2'})"
            :import-zip="async () => ({id: 'user.cat'})"
            :update-pack="succeed"
            :update-sticker="succeed"
            :delete-pack="succeed"
            :delete-sticker="succeed"
            :delete-file="succeed"
            :list-files="succeed"
            :allowlist-usage="async () => ['剧情问答', '设定核对']"
            @select="(id: string) => (selected = id)"
        />
    </div>
</template>

<style scoped>
.stickers-fixture {
    width: 820px;
    max-width: 100%;
    height: 620px;
    box-sizing: border-box;
    padding: 16px;
    background: var(--surface-panel, var(--surface-base));
}

.stickers-fixture.is-narrow {
    width: 480px;
}
</style>
