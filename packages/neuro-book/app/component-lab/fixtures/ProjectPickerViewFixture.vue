<script setup lang="ts">
import {computed, ref} from "vue";
import ProjectPickerView from "nbook/app/components/novel-ide/project-picker/ProjectPickerView.vue";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {ProjectPickerCreatePayload} from "nbook/app/components/novel-ide/project-picker/ProjectPickerView.types";
import {emptyProjectPickerRecovery} from "nbook/app/utils/project-picker-recovery";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ProjectPickerView>(() => props.input, ["cover-error", "open", "open-user-assets", "open-create-form", "cancel-create-form", "create", "delete", "retry-load"]);
const pickerRecoveries = ref(emptyProjectPickerRecovery());
const coverRecoveries = ref(new Map());
const viewBindings = computed(() => ({...subject.bindings.value, pickerRecoveries: pickerRecoveries.value, coverRecoveries: coverRecoveries.value}));

function handleOpenCreateForm(): void {
    subject.write("props", "isCreateFormOpen", true);
}

function handleCancelCreateForm(): void {
    subject.write("props", "isCreateFormOpen", false);
}

function handleCreate(payload: ProjectPickerCreatePayload): void {
    const newRoot = `workspace/projects/${payload.title.toLowerCase().replace(/\s+/g, "-")}`;
    const genreMap: Record<string, string> = {
        scifi: "科幻未来",
        xuanhuan: "玄幻修真",
        urban: "都市职场",
        mystery: "悬疑惊悚",
        world: "世界设定",
        general: "通用创作",
    };
    const genreTag = payload.genre ? genreMap[payload.genre] : undefined;
    const projectTagsMap = subject.bindings.value.projectTags ?? {};
    if (genreTag && typeof projectTagsMap !== "function") {
        subject.write("props", "projectTags", {...projectTagsMap, [newRoot]: [genreTag]});
    }
    subject.write("props", "projects", [{
        projectRoot: newRoot,
        kind: "novel",
        title: payload.title,
        summary: payload.summary,
        manifestUpdatedAt: "2026-09-10T15:30:00Z",
    }, ...subject.bindings.value.projects]);
    subject.write("props", "isCreateFormOpen", false);
}

function handleDelete(project: ProjectMetadataDto): void {
    subject.write("props", "projects", subject.bindings.value.projects.filter((item) => item.projectRoot !== project.projectRoot));
}

function handleRetryLoad(): void {
    subject.write("props", "loadError", "");
    subject.write("props", "isLoading", true);
    setTimeout(() => subject.write("props", "isLoading", false), 500);
}
</script>

<template>
    <div
        class="h-full w-full overflow-hidden"
        data-lab-subject
    >
        <ProjectPickerView
            v-bind="viewBindings"
            @open-create-form="handleOpenCreateForm"
            @cancel-create-form="handleCancelCreateForm"
            @create="handleCreate"
            @delete="handleDelete"
            @retry-load="handleRetryLoad"
        />
    </div>
</template>
