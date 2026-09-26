<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof Dialog>(() => props.input, ["request-close", "confirm"]);

function closeDialog(): void {
    subject.write("model", "modelValue", false);
}
</script>

<template>
    <Dialog data-lab-subject v-bind="subject.bindings.value" @request-close="closeDialog" @confirm="closeDialog">
        <template #header-extra>
            <span v-if="subject.slots.value['header-extra']" class="shrink-0 text-xs text-[var(--text-muted)]">Lab 示例</span>
        </template>
        <template v-if="subject.slots.value.default" #default>
            <div class="space-y-3">
                <p>这是由受控状态驱动的对话框正文。</p>
                <p class="text-xs text-[var(--text-muted)]">关闭、取消和确认请求会记录在 Lab 事件面板。</p>
            </div>
        </template>
        <template v-if="subject.slots.value.footer" #footer="{confirm, cancel}">
            <button type="button" class="h-8 rounded-md border border-[var(--border-color)] px-3 text-sm text-[var(--text-main)]" @click="cancel">取消</button>
            <button type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-sm text-[var(--text-inverse)]" @click="confirm">确认</button>
        </template>
    </Dialog>
</template>
