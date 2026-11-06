<script setup lang="ts">
/**
 * 主题编辑器的“场景与取景”分区（同名 .md）：当前明暗的场景图和工作态场景、场景提供者、预览状态，以及五个位置的取景。
 * 上传条是 `SceneImageSlot`。
 */
import {computed, ref, watch} from "vue";

import {SegmentedControl, Select} from "@notnotype/nb-ui/components";

import {useWorkbenchText} from "../../text";
import {userThemeAssetUrl} from "../../themes";
import CropEditor from "./CropEditor.vue";
import SceneImageSlot from "./SceneImageSlot.vue";
import type {ThemeEditorModel} from "./theme-editor-model";
import type {ThemeTransfer} from "./transfer";

defineOptions({name: "ThemeEditorScene"});

const props = defineProps<{model: ThemeEditorModel; transfer: ThemeTransfer}>();
const text = useWorkbenchText();
const model = props.model;

const theme = computed(() => model.current.value);
const sceneName = computed(() => theme.value?.declaration[model.appearance.value].scene ?? null);
const sceneUrl = computed(() => (sceneName.value === null ? null : userThemeAssetUrl(sceneName.value)));
const workingName = computed(() => theme.value?.declaration[model.appearance.value].workingScene ?? null);
const workingUrl = computed(() => (workingName.value === null ? null : userThemeAssetUrl(workingName.value)));

const loadFailed = ref(false);
const workingLoadFailed = ref(false);
// 图换了（换明暗、换主题、移除）：上一张图的“加载失败”不再适用。
watch(sceneUrl, () => {
    loadFailed.value = false;
});
watch(workingUrl, () => {
    workingLoadFailed.value = false;
});

/** “无”用一个不会是贡献 id 的值（贡献 id 都带点）。 */
const NO_PROVIDER = "none";
/** 已发布的提供者；声明里已有的提供者没发布时保留为不可选的“未发布”项，免得下拉丢了当前值。 */
const providerOptions = computed(() => {
    const published = model.sceneProviders.value;
    const current = theme.value?.declaration.sceneProvider;
    const options: Array<{value: string; label: string; description?: string; disabled?: boolean}> = [
        {value: NO_PROVIDER, label: text("themeEditor.scene.provider.none")},
        ...published.map((id) => ({value: id, label: id})),
    ];
    if (current !== undefined && !published.includes(current)) options.push({value: current, label: current, description: text("themeEditor.scene.provider.unpublished"), disabled: true});
    return options;
});

const previewOptions = computed(() => [
    {value: "follow", label: text("themeEditor.scene.preview.follow")},
    {value: "idle", label: text("themeEditor.scene.preview.idle")},
    {value: "working", label: text("themeEditor.scene.preview.working")},
]);
const previewValue = computed(() => (model.previewWorking.value === null ? "follow" : model.previewWorking.value ? "working" : "idle"));
const setPreview = (value: string): void => {
    model.previewWorking.value = value === "follow" ? null : value === "working";
};
</script>

<template>
    <div class="theme-editor-scene" data-section="scene">
        <SceneImageSlot :model="model" :transfer="transfer" kind="scene" :name="sceneName" @stored="loadFailed = false" />
        <p v-if="loadFailed" class="theme-editor-scene__error" role="alert">{{ text("themeEditor.scene.loadFailed") }}</p>

        <p v-if="sceneUrl === null" class="theme-editor-scene__empty" data-scene-none>{{ text("themeEditor.scene.none") }}</p>
        <CropEditor
            v-else
            :key="sceneUrl"
            :image-url="sceneUrl"
            :crop="theme?.declaration.crop"
            @change="(region, css) => model.setCrop(region, css)"
            @content-x="model.setContentX($event)"
            @load-failed="loadFailed = true"
        />

        <section class="theme-editor-scene__block" data-working-scene>
            <h3 class="theme-editor-scene__title">{{ text("themeEditor.scene.working.title") }}</h3>
            <p class="theme-editor-scene__hint">{{ text("themeEditor.scene.working.hint") }}</p>
            <SceneImageSlot :model="model" :transfer="transfer" kind="working" :name="workingName" @stored="workingLoadFailed = false" />
            <p v-if="workingLoadFailed" class="theme-editor-scene__error" role="alert">{{ text("themeEditor.scene.loadFailed") }}</p>
            <img v-if="workingUrl !== null" :key="workingUrl" class="theme-editor-scene__thumb" :src="workingUrl" :alt="text('themeEditor.scene.working.title')" data-working-thumb @error="workingLoadFailed = true" />
            <p v-else class="theme-editor-scene__empty" data-working-none>{{ text("themeEditor.scene.working.none") }}</p>
        </section>

        <section class="theme-editor-scene__block" data-scene-provider>
            <h3 class="theme-editor-scene__title">{{ text("themeEditor.scene.provider.title") }}</h3>
            <p class="theme-editor-scene__hint">{{ text("themeEditor.scene.provider.hint") }}</p>
            <div class="theme-editor-scene__select">
                <Select
                    size="sm"
                    :model-value="theme?.declaration.sceneProvider ?? NO_PROVIDER"
                    :options="providerOptions"
                    :aria-label="text('themeEditor.scene.provider.title')"
                    @update:model-value="model.setSceneProvider($event === NO_PROVIDER ? undefined : $event)"
                />
            </div>
        </section>

        <section class="theme-editor-scene__block" data-scene-preview>
            <h3 class="theme-editor-scene__title">{{ text("themeEditor.scene.preview.title") }}</h3>
            <SegmentedControl size="sm" :model-value="previewValue" :options="previewOptions" :aria-label="text('themeEditor.scene.preview.title')" data-preview-state @update:model-value="setPreview($event as string)" />
            <p class="theme-editor-scene__hint">{{ text("themeEditor.scene.preview.hint") }}</p>
        </section>
    </div>
</template>

<style scoped>
.theme-editor-scene {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.theme-editor-scene__block {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: var(--border-w) solid var(--divider);
}

.theme-editor-scene__title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
}

.theme-editor-scene__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.theme-editor-scene__select {
    min-width: 220px;
    max-width: 100%;
}

.theme-editor-scene__thumb {
    max-width: 100%;
    max-height: 160px;
    border-radius: var(--radius-control);
    border: var(--border-w) solid var(--border-color);
}

.theme-editor-scene__error {
    margin: 0;
    color: var(--status-danger);
    font-size: var(--text-xs);
}

.theme-editor-scene__empty {
    margin: 0;
    padding: var(--space-8);
    border: var(--border-w) dashed var(--border-color);
    border-radius: var(--radius-control);
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-align: center;
}
</style>
