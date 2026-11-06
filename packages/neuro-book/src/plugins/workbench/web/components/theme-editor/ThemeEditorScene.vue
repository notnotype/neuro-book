<script setup lang="ts">
/** 主题编辑器的“场景与取景”分区（同名 .md）：当前明暗的场景图（上传、更换、移除）和五个位置的取景。 */
import {computed, ref} from "vue";

import {Button} from "@notnotype/nb-ui/components";

import {useWorkbenchText} from "../../text";
import {userThemeSceneUrl} from "../../themes";
import CropEditor from "./CropEditor.vue";
import {prepareImage, SCENE_SUGGESTED_BYTES, uploadScene} from "./scene-upload";
import type {ThemeEditorModel} from "./theme-editor-model";

defineOptions({name: "ThemeEditorScene"});

const props = defineProps<{model: ThemeEditorModel}>();
const text = useWorkbenchText();
const model = props.model;

const theme = computed(() => model.current.value);
const sceneName = computed(() => theme.value?.declaration[model.appearance.value].scene ?? null);
const sceneUrl = computed(() => (sceneName.value === null ? null : userThemeSceneUrl(sceneName.value)));

const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const failure = ref<string | null>(null);
const note = ref<string | null>(null);
const loadFailed = ref(false);

const choose = (): void => input.value?.click();

const onFile = async (event: Event): Promise<void> => {
    const element = event.target as HTMLInputElement;
    const file = element.files?.[0];
    element.value = "";
    if (file === undefined) return;
    busy.value = true;
    failure.value = null;
    note.value = null;
    try {
        const prepared = await prepareImage(file);
        const uploaded = await uploadScene(prepared.blob);
        if (!uploaded.ok) {
            failure.value = text("themeEditor.scene.failed", {reason: uploaded.reason});
            return;
        }
        loadFailed.value = false;
        await model.setScene(uploaded.name);
        const kb = String(Math.round(prepared.blob.size / 1024));
        note.value = prepared.blob.size > SCENE_SUGGESTED_BYTES ? text("themeEditor.scene.large", {kb}) : text("themeEditor.scene.stored", {kb});
    } catch (error) {
        failure.value = text("themeEditor.scene.failed", {reason: error instanceof Error ? error.message : String(error)});
    } finally {
        busy.value = false;
    }
};
</script>

<template>
    <div class="theme-editor-scene" data-section="scene">
        <div class="theme-editor-scene__bar">
            <Button size="sm" :loading="busy" icon-class="i-lucide-image-plus" data-scene-upload @click="choose">{{ sceneName === null ? text("themeEditor.scene.upload") : text("themeEditor.scene.replace") }}</Button>
            <Button size="sm" variant="ghost" :disabled="sceneName === null || busy" data-scene-remove @click="model.setScene(undefined)">{{ text("themeEditor.scene.remove") }}</Button>
            <span v-if="busy" class="theme-editor-scene__note" role="status">{{ text("themeEditor.scene.uploading") }}</span>
            <span v-else-if="note !== null" class="theme-editor-scene__note" data-scene-note>{{ note }}</span>
            <input ref="input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp" class="theme-editor-scene__file" data-scene-file @change="onFile" />
        </div>
        <p v-if="failure !== null" class="theme-editor-scene__error" role="alert" data-scene-error>{{ failure }}</p>
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
    </div>
</template>

<style scoped>
.theme-editor-scene {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.theme-editor-scene__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
}

.theme-editor-scene__file {
    display: none;
}

.theme-editor-scene__note {
    color: var(--text-muted);
    font-size: var(--text-xs);
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
