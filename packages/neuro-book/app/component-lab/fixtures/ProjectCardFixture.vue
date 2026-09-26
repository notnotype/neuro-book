<script setup lang="ts">
import ProjectCard from "nbook/app/components/novel-ide/project-picker/components/ProjectCard.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ProjectCard>(() => props.input, ["open", "delete", "retry-delete-recovery", "open-cover-dialog", "cover-error"]);

function handleDelete(): void {
    subject.write("props", "deleteBusy", true);
    setTimeout(() => subject.write("props", "deleteBusy", false), 1200);
}

function handleRetryDeleteRecovery(): void {
    subject.write("props", "deleteRecovery", {attempt: 2, commitState: "unknown", error: "已请求重试，等待结果。"});
}

function fakeResolveCoverUrl(): string {
    return "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&q=80";
}
</script>

<template>
    <div class="p-6">
        <ProjectCard
            data-lab-subject
            class="w-full"
            v-bind="subject.bindings.value"
            :resolve-cover-url="fakeResolveCoverUrl"
            @delete="handleDelete"
            @retry-delete-recovery="handleRetryDeleteRecovery"
        />
    </div>
</template>
