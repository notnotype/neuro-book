<script setup lang="ts">
import {computed, ref, watch} from "vue";
import EditorSettingsView from "../../components/novel-ide/settings/sections/EditorSettingsView.vue";
import {
    DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
    DEFAULT_MONACO_EDITOR_PREFERENCES,
    type MarkdownEditorPreferences,
    type MonacoEditorPreferences,
} from "nbook/shared/editor-workbench";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "custom" | "indent-off" | "boundary";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "custom", "indent-off", "boundary"];
    return known.find((key) => key === props.scene) ?? "default";
});

function sceneMarkdown(scene: SceneKey): MarkdownEditorPreferences {
    if (scene === "custom") {
        return {
            ...DEFAULT_MARKDOWN_EDITOR_PREFERENCES,
            fontFamily: "\"LXGW WenKai\", \"KaiTi\", \"STKaiti\", serif",
            fontSize: 20,
            lineHeight: 2.1,
            contentWidth: 1000,
            paragraphIndentEnabled: true,
            paragraphIndentEm: 1.5,
        };
    }
    if (scene === "boundary") {
        return {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, fontSize: 12, lineHeight: 1.2, contentWidth: 520, paragraphIndentEnabled: true, paragraphIndentEm: 0};
    }
    if (scene === "indent-off") {
        return {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES, paragraphIndentEnabled: false, paragraphIndentEm: 2.5};
    }
    return {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES};
}

function sceneMonaco(scene: SceneKey): MonacoEditorPreferences {
    if (scene === "custom") {
        return {...DEFAULT_MONACO_EDITOR_PREFERENCES, fontSize: 13, lineHeight: 24, tabSize: 2, minimapEnabled: true, renderWhitespace: true};
    }
    if (scene === "boundary") {
        return {...DEFAULT_MONACO_EDITOR_PREFERENCES, fontSize: 32, lineHeight: 56, tabSize: 8};
    }
    return {...DEFAULT_MONACO_EDITOR_PREFERENCES};
}

const markdown = ref<MarkdownEditorPreferences>(sceneMarkdown("default"));
const monaco = ref<MonacoEditorPreferences>(sceneMonaco("default"));

watch(sceneKey, (scene) => {
    markdown.value = sceneMarkdown(scene);
    monaco.value = sceneMonaco(scene);
}, {immediate: true});

watch([markdown, monaco], () => {
    syncLabData({markdown: {...markdown.value}, monaco: {...monaco.value}});
}, {immediate: true});

/** 就地接受修改并记录事件，不写 store、不写 localStorage。 */
function updateMarkdown(value: MarkdownEditorPreferences): void {
    markdown.value = value;
    emitLabEvent("update:markdown", {...value});
}

function updateMonaco(value: MonacoEditorPreferences): void {
    monaco.value = value;
    emitLabEvent("update:monaco", {...value});
}

/** 重置由宿主决定重置成什么，Lab 里就恢复两份文档化默认值。 */
function resetPreferences(target: "markdown" | "monaco"): void {
    if (target === "markdown") {
        markdown.value = {...DEFAULT_MARKDOWN_EDITOR_PREFERENCES};
    } else {
        monaco.value = {...DEFAULT_MONACO_EDITOR_PREFERENCES};
    }
    emitLabEvent("reset", {target});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <EditorSettingsView
                :markdown="markdown"
                :monaco="monaco"
                @update:markdown="updateMarkdown"
                @update:monaco="updateMonaco"
                @reset="resetPreferences"
            />
        </div>
    </div>
</template>
