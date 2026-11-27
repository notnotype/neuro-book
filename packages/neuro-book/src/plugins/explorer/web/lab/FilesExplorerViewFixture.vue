<script setup lang="ts">
/**
 * FilesExplorerView 的 Lab 夹具：多数场景把场景输入直接绑到视图上（受控零件）；`live` 场景挂产品里同一个视图宿主、
 * 控制器与命令，文件客户端换成内存适配器（`explorer/web/lab/ExplorerLiveScene.vue`）。
 */
import FilesExplorerView from "nbook/plugins/explorer/web/components/FilesExplorerView.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import ExplorerLiveScene from "./ExplorerLiveScene.vue";
import {provideExplorerText} from "./explorer-text";

const props = defineProps<LabFixtureProps>();
// 视图的文字来自注入的翻译端口，Lab 窗口的端口没有本插件的目录：另建一个，只给这个场景。
provideExplorerText(props.scene);
const subject = useLabSubject<typeof FilesExplorerView>(() => props.input, [
    "row-press", "row-activate", "row-context", "retry", "reconnect", "open-project", "dismiss-notice", "prefs-retry", "prefs-discard", "focus-change", "collision", "recheck", "abandon", "dialog-close",
]);
</script>

<template>
    <ExplorerLiveScene v-if="props.scene === 'live'" />
    <FilesExplorerView v-else v-bind="subject.bindings.value" :handle-key="() => 'none'" class="h-full w-full" data-lab-subject />
</template>
