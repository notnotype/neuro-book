<script setup lang="ts">
/**
 * 命令场景的浮层：S4 命令面板与 agent 调用的确认闸门，都 portal 到 body。
 *
 * 画布里只留 Teleport 占位，缩放画布不缩放也不裁切浮层。`paletteSubject` 为真时把打开中的
 * 面板标成受检零件（属性只落在 portal 出的面板根上，关闭时不存在）。
 */
import {AlertDialog as NbAlertDialog} from "@notnotype/nb-ui/components";
import WorkbenchCommandPalette from "nbook/app/components/workbench/WorkbenchCommandPalette.vue";
import type {LabCommandScene} from "./lab-command-scene";

const props = defineProps<{
    scene: LabCommandScene;
    paletteSubject?: boolean;
}>();

const confirmation = props.scene.confirmation;
</script>

<template>
    <WorkbenchCommandPalette
        :host="props.scene.host"
        :title-of="props.scene.titleOf"
        :data-lab-subject="props.paletteSubject ? '' : undefined"
    />

    <!-- 等面板 closed 后才显示，关闭并完成焦点归还后才结算 Promise -->
    <NbAlertDialog
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
                <span class="block">{{ confirmation.pending.value.request.callerId }} 请求执行「{{ confirmation.title.value }}」。</span>
                <span class="mt-1 block break-all font-mono text-[11px]">{{ confirmation.args.value }}</span>
                <span class="mt-1 block">仅操作当前 Lab 内存文档。</span>
            </template>
        </template>
    </NbAlertDialog>
</template>
