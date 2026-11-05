<script setup lang="ts">
import {Button, ColorSwatches, SegmentedControl, Slider, Switch} from "@notnotype/nb-ui/components";
import type {SegmentedControlValue} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {rawUrlOf} from "nbook/plugins/files/shared/contracts";
import BackgroundLayer from "nbook/ui/background/BackgroundLayer.vue";
import {BACKGROUND_COLOR_PRESETS, DEFAULT_SCRIM, MODE_FLOOR} from "nbook/ui/background/background-legibility";
import {backgroundColorIsLegible, documentAppearance, useDocumentThemeVersion, usePrefersSolid} from "nbook/ui/background/document-colors";
import {useBackgroundImage} from "nbook/ui/background/use-background-image";

import type {BackgroundImageSetting, EditorBackgroundSetting} from "../../shared/contracts";
import {useWorkbenchText} from "../text";

/** 一种背景的设置（同名 .md）：选种类、选图或选色、调遮罩，上面是预览。 */
const props = defineProps<{
    title: string;
    value: EditorBackgroundSetting;
    /** 只有正文背景有纯色。 */
    allowColor: boolean;
    images: ReadonlyArray<string>;
    /** 传一张图，成功回它的地址；失败时错误由调用方翻译好。 */
    upload: (file: File) => Promise<{readonly ok: true; readonly address: string} | {readonly ok: false; readonly reason: string}>;
    disabled: boolean;
}>();
const emit = defineEmits<{change: [value: EditorBackgroundSetting]}>();

const text = useWorkbenchText();
const themeVersion = useDocumentThemeVersion();
const prefersSolid = usePrefersSolid();
const error = ref<string | null>(null);
const uploading = ref(false);

/** 选了“图片”还没有图时不写设置（缺字段写不进去），所以种类单独记一份，设置变了跟过去。 */
const mode = ref<EditorBackgroundSetting["kind"]>(props.value.kind);
watch(() => props.value.kind, (kind) => {
    mode.value = kind;
});

const kinds = computed(() => [
    {value: "none", label: text("backgrounds.none")},
    ...(props.allowColor ? [{value: "color", label: text("backgrounds.color")}] : []),
    {value: "image", label: text("backgrounds.image")},
]);
const fits = computed(() => [
    {value: "cover", label: text("backgrounds.cover")},
    {value: "contain", label: text("backgrounds.contain")},
    {value: "repeat", label: text("backgrounds.repeat")},
]);

const imageValue = computed<BackgroundImageSetting | null>(() => (props.value.kind === "image" ? props.value : null));
const colorValue = computed(() => (props.value.kind === "color" ? props.value : null));

/** 拖动时只改预览，松手才写设置（输出 9）。 */
const draftScrim = ref<number | null>(null);
const preview = useBackgroundImage(() => {
    const current = imageValue.value;
    const url = current === null ? null : rawUrlOf(current.image, null);
    return current === null || url === null ? null : {url, fit: current.fit, blur: current.blur, scrim: draftScrim.value ?? current.scrim};
}, () => undefined);
const floor = computed(() => preview.active.value?.floor ?? (imageValue.value?.blur === false ? MODE_FLOOR.sharp : MODE_FLOOR.blur));
const shownScrim = computed(() => Math.max(draftScrim.value ?? imageValue.value?.scrim ?? DEFAULT_SCRIM, floor.value));

const appearance = computed<"light" | "dark">(() => {
    void themeVersion.value;
    return documentAppearance();
});
const shownColor = computed(() => {
    void themeVersion.value;
    const color = colorValue.value?.[appearance.value] ?? null;
    return color !== null && backgroundColorIsLegible(color) ? color : null;
});
/** 暗色的那一个要切到暗色才算得出来，显示时同样拦着（输出 7）。 */
const colorRejected = computed(() => colorValue.value !== null && shownColor.value === null);

function selectKind(kind: SegmentedControlValue): void {
    error.value = null;
    if (kind === "none") {
        mode.value = "none";
        emit("change", {kind: "none"});
    } else if (kind === "color") {
        mode.value = "color";
        const preset = BACKGROUND_COLOR_PRESETS[0];
        emit("change", {kind: "color", light: preset.light, dark: preset.dark});
    } else {
        mode.value = "image";
    }
}

function pickColor(which: "light" | "dark", color: string | null): void {
    const current = colorValue.value;
    if (color === null || current === null) return;
    error.value = null;
    if (which === appearance.value && !backgroundColorIsLegible(color)) {
        error.value = text("backgrounds.failure.colorIllegible");
        return;
    }
    emit("change", {...current, [which]: color});
}

function pickImage(image: string): void {
    error.value = null;
    const current = imageValue.value;
    emit("change", current === null ? {kind: "image", image, fit: "cover", blur: true, scrim: DEFAULT_SCRIM} : {...current, image});
}

function patchImage(patch: Partial<Pick<BackgroundImageSetting, "fit" | "blur" | "scrim">>): void {
    const current = imageValue.value;
    if (current !== null) emit("change", {...current, ...patch});
}

function onScrimInput(next: number | number[]): void {
    draftScrim.value = Array.isArray(next) ? next[0] ?? null : next;
}

function onScrimCommit(next: number | number[]): void {
    const scrim = Array.isArray(next) ? next[0] : next;
    draftScrim.value = null;
    if (scrim !== undefined) patchImage({scrim});
}

const fileInput = ref<HTMLInputElement | null>(null);
async function onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // 清掉：同一个文件再选一次也要触发。
    input.value = "";
    if (file === undefined) return;
    error.value = null;
    uploading.value = true;
    const result = await props.upload(file);
    uploading.value = false;
    if (result.ok) pickImage(result.address);
    else error.value = result.reason;
}

const status = computed(() => {
    if (error.value !== null) return {tone: "error", message: error.value};
    if (preview.failed.value) return {tone: "error", message: text("backgrounds.failure.loadFailed")};
    if (colorRejected.value) return {tone: "error", message: text("backgrounds.failure.colorIllegible")};
    if (imageValue.value !== null && prefersSolid.value) return {tone: "info", message: text("backgrounds.failure.solid")};
    return null;
});
</script>

<template>
    <section class="flex min-w-0 flex-col gap-3" data-background-block>
        <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h3 class="m-0 text-sm font-semibold text-[var(--text-main)]">{{ props.title }}</h3>
            <SegmentedControl :model-value="mode" :options="kinds" :disabled="props.disabled" :aria-label="props.title" size="sm" @update:model-value="selectKind" />
        </div>

        <div v-if="mode !== 'none'" class="relative isolate h-24 min-w-0 overflow-hidden rounded-[var(--radius-control)] border border-[var(--divider)] bg-[var(--bg-panel)]" data-background-preview>
            <BackgroundLayer
                v-if="preview.active.value !== null"
                :url="preview.active.value.url"
                :fit="preview.active.value.fit"
                :blur="preview.active.value.blur"
                :alpha="preview.active.value.alpha"
            />
            <BackgroundLayer v-else-if="shownColor !== null" :url="null" :color="shownColor" />
            <div class="relative flex h-full flex-col justify-center gap-0.5 px-4 text-sm">
                <span class="text-[var(--text-main)]">{{ text("backgrounds.sampleMain") }}</span>
                <span class="text-[var(--text-secondary)]">{{ text("backgrounds.sampleSecondary") }}</span>
                <span class="text-[var(--accent-text)]">{{ text("backgrounds.sampleLink") }}</span>
            </div>
        </div>

        <template v-if="mode === 'color' && colorValue !== null">
            <div v-for="which in (['light', 'dark'] as const)" :key="which" class="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span class="text-sm text-[var(--text-secondary)]">{{ text(which === 'light' ? 'backgrounds.light' : 'backgrounds.dark') }}</span>
                <ColorSwatches
                    :model-value="colorValue[which]"
                    :colors="BACKGROUND_COLOR_PRESETS.map((preset) => preset[which])"
                    :custom-label="text('backgrounds.custom')"
                    :label="text(which === 'light' ? 'backgrounds.light' : 'backgrounds.dark')"
                    :disabled="props.disabled"
                    :data-background-swatches="which"
                    @update:model-value="pickColor(which, $event)"
                />
            </div>
        </template>

        <template v-if="mode === 'image'">
            <div class="flex min-w-0 flex-wrap items-center gap-2" role="group" :aria-label="text('backgrounds.gallery')" data-background-gallery>
                <button
                    v-for="image in props.images"
                    :key="image"
                    type="button"
                    class="h-12 w-20 cursor-pointer overflow-hidden rounded-[var(--radius-control)] border-0 bg-transparent p-0 outline outline-offset-1 focus-visible:outline-2 focus-visible:outline-[var(--accent-main)]"
                    :class="imageValue?.image === image ? 'outline-2 outline-[var(--accent-main)]' : 'outline-1 outline-[var(--divider)]'"
                    :disabled="props.disabled"
                    :aria-pressed="imageValue?.image === image"
                    :data-background-image-option="image"
                    @click="pickImage(image)"
                >
                    <img class="block h-full w-full object-cover" :src="rawUrlOf(image, null) ?? undefined" alt="" loading="lazy" />
                </button>
                <Button size="sm" variant="secondary" icon-class="i-lucide-upload" :loading="uploading" :disabled="props.disabled" data-background-upload @click="fileInput?.click()">
                    {{ text(uploading ? "backgrounds.uploading" : "backgrounds.upload") }}
                </Button>
                <input ref="fileInput" class="hidden" type="file" accept="image/png,image/jpeg,image/webp" data-background-file @change="onFile" />
            </div>
            <template v-if="imageValue !== null">
                <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span class="text-sm text-[var(--text-secondary)]">{{ text("backgrounds.fit") }}</span>
                    <SegmentedControl :model-value="imageValue.fit" :options="fits" :disabled="props.disabled" :aria-label="text('backgrounds.fit')" size="sm" @update:model-value="patchImage({fit: $event as BackgroundImageSetting['fit']})" />
                </div>
                <div class="flex min-w-0 items-center justify-between gap-2">
                    <span class="text-sm text-[var(--text-secondary)]">{{ text("backgrounds.blur") }}</span>
                    <Switch :model-value="imageValue.blur" :disabled="props.disabled" :aria-label="text('backgrounds.blur')" data-background-blur @update:model-value="patchImage({blur: $event})" />
                </div>
                <div class="flex min-w-0 items-center gap-3">
                    <span class="shrink-0 text-sm text-[var(--text-secondary)]">{{ text("backgrounds.scrim") }}</span>
                    <Slider
                        class="min-w-0 flex-1"
                        :model-value="shownScrim"
                        :min="floor"
                        :max="100"
                        :step="1"
                        size="sm"
                        :disabled="props.disabled"
                        :aria-label="text('backgrounds.scrim')"
                        data-background-scrim-slider
                        @update:model-value="onScrimInput"
                        @value-commit="onScrimCommit"
                    />
                    <span class="w-9 shrink-0 text-right text-sm tabular-nums text-[var(--text-secondary)]" data-background-scrim-value>{{ shownScrim }}%</span>
                </div>
            </template>
        </template>

        <p v-if="status !== null" class="m-0 text-sm" :class="status.tone === 'error' ? 'text-[var(--status-danger)]' : 'text-[var(--text-secondary)]'" role="status" data-background-status>{{ status.message }}</p>
    </section>
</template>
