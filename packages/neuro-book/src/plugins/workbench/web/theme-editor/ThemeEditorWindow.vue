<script setup lang="ts">
/** 主题编辑器的浮动窗口（同名 .md）：和页签里同一个主体，放进 nb-ui 的浮动窗口；窗口开着才挂载主体，卸载时释放模型。 */
import {computed} from "vue";

import {FloatingWindow} from "@notnotype/nb-ui/components";

import {useWorkbenchText} from "../text";
import type {ThemeEntry} from "../themes";
import ThemeEditorHolder from "./ThemeEditorHolder.vue";
import type {ThemeEditorSession} from "./theme-editor-session";

defineOptions({name: "ThemeEditorWindow"});

const props = defineProps<{
    session: ThemeEditorSession;
    themes: () => ReadonlyArray<ThemeEntry>;
}>();

const text = useWorkbenchText();
const open = computed(() => props.session.floating.value);
</script>

<template>
    <FloatingWindow
        :open="open"
        :title="text('themeEditor.title')"
        :close-label="text('themeEditor.close')"
        closable
        resizable
        :show-footer="false"
        :width="920"
        :height="640"
        :min-width="360"
        :min-height="360"
        body-class="!p-0"
        @update:open="session.floating.value = $event"
    >
        <ThemeEditorHolder :session="session" :themes="themes()" @close="session.floating.value = false" />
    </FloatingWindow>
</template>
