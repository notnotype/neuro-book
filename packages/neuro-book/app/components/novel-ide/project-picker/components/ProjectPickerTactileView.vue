<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {ProjectPickerRecoveryEntry} from "nbook/app/utils/project-picker-recovery";
import ProjectCardTactile from "./ProjectCardTactile.vue";

const props = withDefaults(defineProps<{
    projects?: readonly ProjectMetadataDto[];
    projectTags?: Record<string, readonly string[]> | ((project: ProjectMetadataDto) => readonly string[] | undefined);
    deleteBusyRoots?: ReadonlySet<string>;
    failedCoverRoots?: ReadonlySet<string>;
    coverRefreshVersions?: Record<string, number>;
    pickerRecoveries?: Readonly<{
        create?: ProjectPickerRecoveryEntry | null;
        deletes: ReadonlyMap<string, ProjectPickerRecoveryEntry>;
    }>;
    resolveCoverUrl?: (projectRoot: string) => string;
    formatDate?: (dateString?: string | null) => string;
}>(), {
    projects: () => [],
    deleteBusyRoots: () => new Set<string>(),
    failedCoverRoots: () => new Set<string>(),
    formatDate: (d?: string | null) => d ?? "",
});

const emit = defineEmits<{
    (e: "open", projectRoot: string): void;
    (e: "delete", project: ProjectMetadataDto): void;
    (e: "retry-delete-recovery", projectRoot: string): void;
    (e: "open-cover-dialog", project: ProjectMetadataDto): void;
    (e: "cover-error", projectRoot: string): void;
    (e: "create-book"): void;
}>();

const {t} = useI18n();

function getTagsFor(project: ProjectMetadataDto): readonly string[] | undefined {
    if (!props.projectTags) return undefined;
    if (typeof props.projectTags === "function") {
        return props.projectTags(project);
    }
    return props.projectTags[project.projectRoot];
}
</script>

<template>
    <div class="tactile-bookshelf-view space-y-8">
        <!-- 书房展台网格 -->
        <div class="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            <!-- 典藏 3D 书籍卡片 -->
            <ProjectCardTactile
                v-for="project in projects"
                :key="project.projectRoot"
                :project="project"
                :tags="getTagsFor(project)"
                :delete-busy="deleteBusyRoots.has(project.projectRoot)"
                :delete-recovery="pickerRecoveries?.deletes.get(project.projectRoot)"
                :cover-refresh-version="coverRefreshVersions?.[project.projectRoot]"
                :failed-cover="failedCoverRoots.has(project.projectRoot)"
                :resolve-cover-url="resolveCoverUrl"
                :format-date="formatDate"
                @open="emit('open', $event)"
                @delete="emit('delete', $event)"
                @retry-delete-recovery="emit('retry-delete-recovery', $event)"
                @open-cover-dialog="emit('open-cover-dialog', $event)"
                @cover-error="emit('cover-error', $event)"
            />

            <!-- 展台空位：+ 开始一部新长篇 -->
            <div
                class="group relative flex flex-col items-center justify-center cursor-pointer select-none py-4 sm:py-6"
                role="button"
                tabindex="0"
                @click="emit('create-book')"
                @keydown.enter="emit('create-book')"
                @keydown.space.prevent="emit('create-book')"
            >
                <div
                    class="relative aspect-[2/3] w-36 sm:w-44 rounded-r-md rounded-l-xs border-2 border-dashed border-[var(--border-color)] group-hover:border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--bg-panel)_40%,transparent)] group-hover:bg-[color-mix(in_srgb,var(--accent-main)_8%,transparent)] transition-all duration-300 flex flex-col items-center justify-center gap-2 text-center p-4 shadow-sm"
                >
                    <div class="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--control-surface)] text-[var(--text-secondary)] group-hover:text-[var(--accent-main)] group-hover:scale-110 transition-all duration-200 shadow-sm border border-[var(--border-color)]">
                        <span class="i-lucide-plus h-5 w-5"></span>
                    </div>
                    <span class="font-serif text-xs font-semibold text-[var(--text-secondary)] group-hover:text-[var(--text-main)] transition-colors">
                        {{ t("ide.bookshelf.createBook") }}
                    </span>
                    <span class="text-[10px] text-[var(--text-muted)] font-mono">
                        新设长篇
                    </span>
                </div>
            </div>
        </div>
    </div>
</template>
