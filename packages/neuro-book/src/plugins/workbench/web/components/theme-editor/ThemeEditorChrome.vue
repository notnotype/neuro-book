<script setup lang="ts">
/** 主题编辑器的“活动栏与画框”分区（同名 .md）：活动栏的面、前景、当前项与两端装饰，浮层画框的线色。 */
import {computed} from "vue";

import {Switch} from "@notnotype/nb-ui/components";

import {useWorkbenchText} from "../../text";
import ColorField from "./ColorField.vue";
import type {ThemeEditorModel} from "./theme-editor-model";

defineOptions({name: "ThemeEditorChrome"});

const props = defineProps<{model: ThemeEditorModel}>();
const text = useWorkbenchText();
const model = props.model;

const look = computed(() => model.current.value?.declaration[model.appearance.value] ?? null);
const bar = computed(() => look.value?.activityBar ?? null);
const FIELDS = ["surface", "foreground", "active"] as const;

const toggleBar = (on: boolean): void => {
    if (on) void model.setActivityBar("surface", bar.value?.surface ?? model.colors.value["--bg-sidebar"]);
    else void model.removeActivityBar();
};
</script>

<template>
    <div class="theme-editor-chrome" data-section="chrome">
        <section class="theme-editor-chrome__block" data-chrome="activity-bar">
            <h3 class="theme-editor-chrome__title">{{ text("themeEditor.chrome.activityBar") }}</h3>
            <label class="theme-editor-chrome__switch">
                <Switch :model-value="bar !== null" :aria-label="text('themeEditor.chrome.activityBarOn')" @update:model-value="toggleBar($event)" />
                <span>{{ text("themeEditor.chrome.activityBarOn") }}</span>
            </label>
            <template v-if="bar !== null">
                <ColorField
                    v-for="field in FIELDS"
                    :key="field"
                    :name="`activityBar.${field}`"
                    :label="text(`themeEditor.chrome.${field}` as 'themeEditor.chrome.surface')"
                    :value="bar[field]"
                    @change="model.setActivityBar(field, $event)"
                />
                <ColorField
                    name="activityBar.ornament"
                    :label="text('themeEditor.chrome.ornament')"
                    :value="bar.ornament ?? ''"
                    @change="model.setActivityBar('ornament', $event === '' ? undefined : $event)"
                />
            </template>
        </section>

        <section class="theme-editor-chrome__block" data-chrome="frame">
            <h3 class="theme-editor-chrome__title">{{ text("themeEditor.chrome.frame") }}</h3>
            <p class="theme-editor-chrome__hint">{{ text("themeEditor.chrome.frameHint") }}</p>
            <ColorField
                name="frame.line"
                :label="text('themeEditor.chrome.frameLine')"
                :value="look?.frame?.line ?? ''"
                @change="model.setFrameLine($event === '' ? undefined : $event)"
            />
        </section>
    </div>
</template>

<style scoped>
.theme-editor-chrome {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

.theme-editor-chrome__block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.theme-editor-chrome__title {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
}

.theme-editor-chrome__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.theme-editor-chrome__switch {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--text-main);
    font-size: var(--text-sm);
}
</style>
