<script setup lang="ts">
/**
 * FilesExplorerView 的 Lab 夹具：多数场景把场景输入直接绑到视图上（受控零件）；`live` 场景挂产品里同一个视图宿主、
 * 控制器与命令，文件客户端换成内存适配器（`explorer-scene/ExplorerLiveScene.vue`）。
 */
import FilesExplorerView from "nbook/plugins/explorer/web/components/FilesExplorerView.vue";

import {useLabSubject} from "../lab-subject";
import type {LabFixtureProps} from "../lab-subject";
import ExplorerLiveScene from "./explorer-scene/ExplorerLiveScene.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof FilesExplorerView>(() => props.input, [
    "toolbar", "row-press", "row-activate", "row-context", "retry", "reconnect", "open-project", "dismiss-notice", "prefs-retry", "prefs-discard", "focus-change", "collision", "recheck", "abandon", "dialog-close",
]);
</script>

<template>
    <ExplorerLiveScene v-if="props.scene === 'live'" />
    <FilesExplorerView v-else v-bind="subject.bindings.value" :handle-key="() => 'none'" class="h-full w-full" data-lab-subject />
</template>
