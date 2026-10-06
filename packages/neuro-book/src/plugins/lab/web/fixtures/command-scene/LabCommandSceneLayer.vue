<script setup lang="ts">
/**
 * 命令场景的浮层：命令面板与 Agent 调用的确认框，都渲染到 body。画布缩放不会缩放或裁切它们。
 * 打开中的面板标成受检零件（属性落在面板根上，关闭时不存在）。
 */
import {AlertDialog} from "@notnotype/nb-ui/components";

import WorkbenchCommandPalette from "nbook/plugins/workbench/web/components/WorkbenchCommandPalette.vue";

import type {LabCommandScene} from "./lab-command-scene";

const props = defineProps<{scene: LabCommandScene}>();

const confirmation = props.scene.confirmation;
</script>

<template>
    <WorkbenchCommandPalette :host="props.scene.palette" data-lab-subject />

    <!-- 面板 closed 之后才显示；关闭并完成焦点归还后才结算 -->
    <AlertDialog
        :open="confirmation.visible.value"
        :title="confirmation.title.value"
        :tone="confirmation.destructive.value ? 'danger' : 'warning'"
        confirm-text="批准执行"
        cancel-text="取消"
        @update:open="confirmation.onOpenChange"
        @confirm="confirmation.settle(true)"
        @cancel="confirmation.settle(false)"
        @closed="confirmation.onClosed"
    >
        <template #description>
            <template v-if="confirmation.pending.value">
                <span class="block">{{ confirmation.pending.value.request.callerId }} 请求执行“{{ confirmation.title.value }}”。</span>
                <span class="mt-1 block break-all font-mono text-[var(--text-xs)]">{{ confirmation.args.value }}</span>
                <span class="mt-1 block">只作用于本场景内存里的样板文档。</span>
            </template>
        </template>
    </AlertDialog>
</template>
