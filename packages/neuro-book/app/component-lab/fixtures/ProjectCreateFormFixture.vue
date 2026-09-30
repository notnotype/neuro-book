<script setup lang="ts">
import ProjectCreateForm from "nbook/app/components/novel-ide/project-picker/components/ProjectCreateForm.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ProjectCreateForm>(() => props.input, ["submit", "retry-recovery"]);

function handleRetryRecovery(): void {
    subject.write("props", "recoveryError", "");
    subject.write("props", "recoveryNotice", "正在重新同步工作区状态...");
}
</script>

<template>
    <div class="w-full p-6">
        <ProjectCreateForm
            data-lab-subject
            class="w-full"
            v-bind="subject.bindings.value"
            @retry-recovery="handleRetryRecovery"
        />
    </div>
</template>
