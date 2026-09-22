<script setup lang="ts">
/**
 * WorkbenchCommandPalette 的 Lab 场景：全局面板在 Lab 里只挂一次，这里不渲染第二个实例。
 *
 * 夹具只承载真实编辑器（直接复用 CodeEditorViewFixture 的场景与控制栏），面板本体由
 * LabShell 挂载。打开中的面板会被 Lab 标成受检零件，关闭时靠这行提示指路。
 */
import {computed} from "vue";
import CodeEditorViewFixture from "./CodeEditorViewFixture.vue";
import {useWorkbenchCommands} from "nbook/app/composables/useWorkbenchCommands";

const props = defineProps<{scene: string; data?: unknown}>();

const host = useWorkbenchCommands();
const paletteOpen = computed(() => host.palette.open.value);
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col">
        <p
            v-if="!paletteOpen"
            class="shrink-0 border-b border-[var(--divider)] bg-[var(--bg-panel)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]"
        >
            全局面板由 Lab 挂一个实例：点底部控制栏的「命令面板」，或按 Ctrl/Cmd+Shift+P 打开；打开时它会作为受检零件被标出。
        </p>
        <div class="min-h-0 flex-1">
            <CodeEditorViewFixture :scene="props.scene" :data="props.data" />
        </div>
    </div>
</template>
