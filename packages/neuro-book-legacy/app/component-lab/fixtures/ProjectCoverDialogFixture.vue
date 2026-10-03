<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import ProjectCoverDialog from "nbook/app/components/novel-ide/project-picker/components/ProjectCoverDialog.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ProjectCoverDialog>(() => props.input, ["upload", "clear", "retry-recovery", "preview-original"]);

function handleUpload(file: File): void {
    subject.write("props", "busy", true);
    setTimeout(() => {
        subject.write("props", "busy", false);
        subject.write("props", "coverUrl", URL.createObjectURL(file));
        const project = subject.bindings.value.project;
        if (project) subject.write("props", "project", {...project, cover: "uploaded-cover.png"});
    }, 1000);
}

function handleClear(): void {
    subject.write("props", "coverUrl", "");
    const project = subject.bindings.value.project;
    if (project) {
        const {cover, ...withoutCover} = project;
        subject.write("props", "project", withoutCover);
    }
}
</script>

<template>
    <div class="flex h-full min-h-[500px] w-full items-center justify-center p-6" data-lab-subject>
        <div v-if="!subject.bindings.value.modelValue" class="text-center">
            <p class="mb-4 text-sm text-[var(--text-secondary)]">封面对话框已关闭</p>
            <Button variant="primary" @click="subject.write('model', 'modelValue', true)">重新打开对话框</Button>
        </div>

        <ProjectCoverDialog
            v-bind="subject.bindings.value"
            @upload="handleUpload"
            @clear="handleClear"
            @retry-recovery="subject.write('props', 'recoveryError', '')"
        />
    </div>
</template>
