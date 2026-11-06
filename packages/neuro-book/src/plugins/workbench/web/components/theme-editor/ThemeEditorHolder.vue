<script setup lang="ts">
/** 把会话里的模型交给主题编辑器主体（同名 .md）：挂载时 `acquire`、卸载时 `release`，页签与浮动窗口共用它。 */
import {onScopeDispose} from "vue";

// 主题包的缺省配色来自装载整套主题包的模块，不能进首屏：这个组件只在编辑器打开时才加载。
import {baseColors} from "nbook/ui/theme/product-themes";

import type {ThemeEntry} from "../../themes";
import ThemeEditor from "./ThemeEditor.vue";
import {ThemeEditorModel} from "./theme-editor-model";
import {uploadScene} from "./scene-upload";
import {copyPluginScenes, exportCurrent, importArchive} from "./transfer";
import type {ThemeTransfer} from "./transfer";
import type {ThemeEditorSession} from "./theme-editor-session";

defineOptions({name: "ThemeEditorHolder"});

const props = withDefaults(defineProps<{
    session: ThemeEditorSession;
    themes: ReadonlyArray<ThemeEntry>;
    /** 页签里不画“关闭”（关页签用标签上的叉）。 */
    closable?: boolean;
}>(), {closable: true});

defineEmits<{(event: "close"): void}>();

props.session.provideBaseColors(baseColors);
const model = props.session.acquire((env, state) => new ThemeEditorModel(env, state));
/** 导出与导入的请求在这里发（见同名文档）；主体只触发与呈现。 */
const transfer: ThemeTransfer = {exportTheme: () => exportCurrent(model), importArchive: (archive) => importArchive(model, archive), uploadScene, copyScenes: (entry) => copyPluginScenes(entry, (appearance) => props.session.sceneUrl(entry, appearance))};
// 用组件作用域的停止配对：setup 之后、挂载之前出错时 `onBeforeUnmount` 不会来，持有计数就永远不归零，预览不清。
onScopeDispose(() => props.session.release());
</script>

<template>
    <ThemeEditor :model="model" :themes="themes" :closable="closable" :transfer="transfer" @close="$emit('close')" />
</template>
