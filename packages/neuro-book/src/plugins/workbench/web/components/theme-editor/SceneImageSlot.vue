<script setup lang="ts">
/** 选一张位图、处理、上传、写进声明的一排操作（同名 .md）：场景图与工作态场景共用，差别只是写进声明的哪个字段。 */
import {ref} from "vue";

import {Button} from "@notnotype/nb-ui/components";

import {useWorkbenchText} from "../../text";
import {prepareImage, SCENE_SUGGESTED_BYTES} from "./scene-upload";
import type {ThemeEditorModel} from "./theme-editor-model";
import type {ThemeTransfer} from "./transfer";

defineOptions({name: "SceneImageSlot"});

const props = defineProps<{model: ThemeEditorModel; transfer: ThemeTransfer; kind: "scene" | "working"; name: string | null}>();
const emit = defineEmits<{(event: "stored"): void}>();
const text = useWorkbenchText();
const model = props.model;

const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const failure = ref<string | null>(null);
const note = ref<string | null>(null);

const write = (name: string | undefined, target: {readonly id: string; readonly appearance: "light" | "dark"} | null = null): Promise<unknown> =>
    props.kind === "scene" ? model.setScene(name, target) : model.setWorkingScene(name, target);

/** 场景图与工作态场景各有一组 `data-scene-*` / `data-working-*` 标记，测试按它们找到各自的控件。 */
const mark = (part: string): Record<string, string> => ({[`data-${props.kind === "scene" ? "scene" : "working"}-${part}`]: ""});

const choose = (): void => input.value?.click();

const onFile = async (event: Event): Promise<void> => {
    const element = event.target as HTMLInputElement;
    const file = element.files?.[0];
    element.value = "";
    if (file === undefined) return;
    // 目标在发起时定下：处理与上传要几百毫秒到几秒，期间用户可能切了明暗或换了主题，图不能落到别处。
    const current = model.current.value;
    const target = current === null ? null : {id: current.id, appearance: model.appearance.value};
    busy.value = true;
    failure.value = null;
    note.value = null;
    try {
        const prepared = await prepareImage(file);
        const uploaded = await props.transfer.uploadScene(prepared.blob);
        if (!uploaded.ok) {
            failure.value = text("themeEditor.scene.failed", {reason: uploaded.reason});
            return;
        }
        emit("stored");
        await write(uploaded.name, target);
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
    <div class="scene-image-slot" :data-slot="kind">
        <div class="scene-image-slot__bar">
            <Button size="sm" :loading="busy" icon-class="i-lucide-image-plus" v-bind="mark('upload')" @click="choose">
                {{ name === null ? text(kind === "scene" ? "themeEditor.scene.upload" : "themeEditor.scene.working.upload") : text(kind === "scene" ? "themeEditor.scene.replace" : "themeEditor.scene.working.replace") }}
            </Button>
            <Button size="sm" variant="ghost" :disabled="name === null || busy" v-bind="mark('remove')" @click="write(undefined)">{{ text("themeEditor.scene.remove") }}</Button>
            <span v-if="busy" class="scene-image-slot__note" role="status">{{ text("themeEditor.scene.uploading") }}</span>
            <span v-else-if="note !== null" class="scene-image-slot__note" v-bind="mark('note')">{{ note }}</span>
            <input ref="input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp" class="scene-image-slot__file" v-bind="mark('file')" @change="onFile" />
        </div>
        <p v-if="failure !== null" class="scene-image-slot__error" role="alert" v-bind="mark('error')">{{ failure }}</p>
    </div>
</template>

<style scoped>
.scene-image-slot {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.scene-image-slot__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
}

.scene-image-slot__file {
    display: none;
}

.scene-image-slot__note {
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.scene-image-slot__error {
    margin: 0;
    color: var(--status-danger);
    font-size: var(--text-xs);
}
</style>
