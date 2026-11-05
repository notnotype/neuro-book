<script setup lang="ts">
import {computed, onMounted, ref} from "vue";

import {BACKGROUND_DIRECTORY_ADDRESS, BACKGROUND_UPLOAD_URL} from "nbook/plugins/files/shared/contracts";
import type {FilesResult, Listing} from "nbook/plugins/files/shared/contracts";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";

import {editorBackgroundSetting, windowBackgroundSetting} from "../../shared/contracts";
import type {EditorBackgroundSetting} from "../../shared/contracts";
import {useWorkbenchText} from "../text";
import BackgroundSettingsBlock from "./BackgroundSettingsBlock.vue";

/** 设置窗口的“背景”页（docs/specs/ui/backgrounds.md 输出 9）：两种背景各一块，已传过的图两块共用。 */
const props = defineProps<{
    context: SettingsPageContext;
    settings: SettingsService;
    /** 列出已传过的图；文件服务不在时为 null。 */
    listImages: () => Promise<FilesResult<Listing> | null>;
}>();

const text = useWorkbenchText();
const images = ref<ReadonlyArray<string>>([]);
const listFailure = ref<string | null>(null);
const editor = computed(() => props.settings.get(editorBackgroundSetting) as EditorBackgroundSetting);
const window_ = computed(() => props.settings.get(windowBackgroundSetting) as EditorBackgroundSetting);
const disabled = computed(() => !props.context.writable.value);

async function refreshImages(): Promise<void> {
    const listed = await props.listImages();
    if (listed === null) return;
    // 一张都没传过时目录还不存在，不算失败。
    if (!listed.ok) {
        listFailure.value = listed.code === "not-found" ? null : listed.detail;
        return;
    }
    listFailure.value = null;
    images.value = listed.value.entries.filter((entry) => entry.kind === "file").map((entry) => `${BACKGROUND_DIRECTORY_ADDRESS}/${entry.name}`);
}
onMounted(() => void refreshImages());

async function upload(file: File): Promise<{readonly ok: true; readonly address: string} | {readonly ok: false; readonly reason: string}> {
    try {
        const response = await fetch(BACKGROUND_UPLOAD_URL, {method: "PUT", body: file});
        const body = (await response.json()) as {readonly address?: string; readonly code?: string; readonly detail?: string};
        if (response.ok && body.address !== undefined) {
            await refreshImages();
            return {ok: true, address: body.address};
        }
        if (body.code === "too-large") return {ok: false, reason: text("backgrounds.failure.tooLarge")};
        if (body.code === "unsupported-type") return {ok: false, reason: text("backgrounds.failure.unsupported")};
        if (body.code === "conflict") return {ok: false, reason: text("backgrounds.failure.conflict")};
        return {ok: false, reason: text("backgrounds.failure.uploadFailed", {detail: body.detail ?? String(response.status)})};
    } catch (error) {
        return {ok: false, reason: text("backgrounds.failure.uploadFailed", {detail: error instanceof Error ? error.message : String(error)})};
    }
}

async function write<T>(setting: SettingDefinition<T>, value: T): Promise<void> {
    const result = await props.settings.update(setting, value, {layer: "user"});
    if (!result.ok) props.context.reportWriteFailure(text("backgrounds.failure.writeSubject"), {reason: result.detail});
}

function onWindowChange(value: EditorBackgroundSetting): void {
    // 窗口背景的块不给纯色；类型上收窄。
    if (value.kind !== "color") void write(windowBackgroundSetting, value);
}
</script>

<template>
    <div class="flex min-w-0 flex-col gap-6" data-background-settings>
        <BackgroundSettingsBlock
            :title="text('backgrounds.editorTitle')"
            :value="editor"
            allow-color
            :images="images"
            :upload="upload"
            :disabled="disabled"
            data-background-kind="editor"
            @change="write(editorBackgroundSetting, $event)"
        />
        <BackgroundSettingsBlock
            :title="text('backgrounds.windowTitle')"
            :value="window_"
            :allow-color="false"
            :images="images"
            :upload="upload"
            :disabled="disabled"
            data-background-kind="window"
            @change="onWindowChange"
        />
        <p v-if="listFailure !== null" class="m-0 text-sm text-[var(--status-danger)]" role="status">{{ text("backgrounds.failure.listFailed", {detail: listFailure}) }}</p>
    </div>
</template>
