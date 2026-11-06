<script setup lang="ts">
/** 主题编辑器的“字体”分区（同名 .md）：欢迎页标题与正文各一个字体栈。 */
import {Button, Input} from "@notnotype/nb-ui/components";

import {useWorkbenchText} from "../text";
import type {ThemeEditorModel} from "./theme-editor-model";

defineOptions({name: "ThemeEditorTypography"});

const props = defineProps<{model: ThemeEditorModel}>();
const text = useWorkbenchText();
const model = props.model;

/** 常用的三个字体栈：浏览器列不出本机字体，给几个起点，其余自己写。 */
const PRESETS = [
    {id: "serif", value: "\"Noto Serif CJK SC\", \"Source Han Serif SC\", \"Songti SC\", serif"},
    {id: "sans", value: "\"Noto Sans CJK SC\", \"Source Han Sans SC\", \"PingFang SC\", system-ui, sans-serif"},
    {id: "mono", value: "ui-monospace, \"JetBrains Mono\", \"SF Mono\", monospace"},
] as const;

const FIELDS = ["display", "prose"] as const;
const valueOf = (which: "display" | "prose"): string => model.current.value?.declaration.fonts?.[which] ?? "";
</script>

<template>
    <div class="theme-editor-fonts" data-section="fonts">
        <p class="theme-editor-fonts__hint">{{ text("themeEditor.fonts.hint") }}</p>
        <section v-for="which in FIELDS" :key="which" class="theme-editor-fonts__field" :data-font="which">
            <h3 class="theme-editor-fonts__title">{{ text(`themeEditor.fonts.${which}` as "themeEditor.fonts.display") }}</h3>
            <Input :model-value="valueOf(which)" :placeholder="text('themeEditor.fonts.placeholder')" :aria-label="text(`themeEditor.fonts.${which}` as 'themeEditor.fonts.display')" @update:model-value="model.setFont(which, $event)" />
            <div class="theme-editor-fonts__presets">
                <Button v-for="preset in PRESETS" :key="preset.id" size="sm" variant="secondary" @click="model.setFont(which, preset.value)">{{ text(`themeEditor.fonts.${preset.id}` as "themeEditor.fonts.serif") }}</Button>
                <Button size="sm" variant="ghost" :disabled="valueOf(which) === ''" @click="model.setFont(which, '')">{{ text("themeEditor.fonts.clear") }}</Button>
            </div>
            <p v-if="valueOf(which) !== ''" class="theme-editor-fonts__sample" :style="{fontFamily: valueOf(which)}">{{ which === "display" ? "NeuroBook · 欢迎回来" : "雨从傍晚开始下，一直没有停。" }}</p>
        </section>
    </div>
</template>

<style scoped>
.theme-editor-fonts {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.theme-editor-fonts__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.theme-editor-fonts__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.theme-editor-fonts__title {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
}

.theme-editor-fonts__presets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.theme-editor-fonts__sample {
    margin: 0;
    color: var(--text-main);
    font-size: var(--text-lg);
}
</style>
