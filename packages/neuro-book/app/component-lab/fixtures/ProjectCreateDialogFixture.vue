<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import ProjectCreateDialog from "nbook/app/components/novel-ide/project-picker/components/ProjectCreateDialog.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ProjectCreateDialog>(() => props.input, ["submit", "cancel", "retry-recovery"]);
function handleSubmit(): void {
    subject.write("props", "isCreating", true);
    setTimeout(() => {
        subject.write("props", "isCreating", false);
        subject.write("props", "isOpen", false);
    }, 1000);
}
function handleCancel(): void {
    subject.write("props", "isOpen", false);
}
function handleRetryRecovery(): void {
    subject.write("props", "recoveryError", "");
}
</script>

<template>
    <div class="relative flex h-full min-h-[500px] w-full items-center justify-center p-6" data-lab-subject>
        <div v-if="!subject.bindings.value.isOpen" class="text-center">
            <p class="mb-4 text-sm text-[var(--text-secondary)]">弹窗已关闭</p>
            <Button variant="primary" @click="subject.write('props', 'isOpen', true)">重新打开对话框</Button>
        </div>

        <ProjectCreateDialog
            v-bind="subject.bindings.value"
            @submit="handleSubmit"
            @cancel="handleCancel"
            @retry-recovery="handleRetryRecovery"
        />
    </div>
</template>
