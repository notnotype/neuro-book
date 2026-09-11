<script setup lang="ts">
import {ref} from "vue";
import {Button, Spinner} from "@notnotype/nb-ui/components";
import type {AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import {formatTimestamp} from "nbook/app/components/novel-ide/agent/agent-message";

const props = defineProps<{
    expanded?: boolean;
    loading?: boolean;
    loaded?: boolean;
    error?: string;
    sessions?: readonly AgentSessionSummaryDto[];
    total?: number;
    hasMore?: boolean;
    actionId?: number | null;
    projects: readonly ProjectMetadataDto[];
}>();

const emit = defineEmits<{
    (e: "toggle"): void;
    (e: "retry"): void;
    (e: "load-more"): void;
    (e: "recover", payload: {session: AgentSessionSummaryDto; targetProjectRoot: string | null}): void;
}>();

const {t} = useI18n();
const targets = ref<Record<number, string>>({});

function handleRecover(session: AgentSessionSummaryDto, workspaceRoot: boolean): void {
    const target = workspaceRoot ? null : (targets.value[session.sessionId] ?? "");
    emit("recover", {session, targetProjectRoot: target});
}
</script>

<template>
    <section class="rounded-[var(--radius-panel,8px)] border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
        <button
            type="button"
            class="flex w-full items-center justify-between gap-4 px-4 py-3 text-left sm:px-5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)]"
            :aria-expanded="expanded"
            @click="emit('toggle')"
        >
            <span class="min-w-0">
                <span class="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                    <span class="i-lucide-message-square-warning h-4 w-4 text-[var(--status-warning)]"></span>
                    {{ t("ide.picker.recoveryTitle") }}
                    <span
                        v-if="loaded"
                        class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-0.5 text-[10px] font-normal text-[var(--text-muted)]"
                    >
                        {{ t("ide.picker.recoveryCount", {count: total ?? 0}) }}
                    </span>
                </span>
                <span class="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">
                    {{ t("ide.picker.recoverySummary") }}
                </span>
            </span>
            <span
                class="i-lucide-chevron-down h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)]"
                :class="expanded ? 'rotate-180' : ''"
            ></span>
        </button>

        <div v-if="expanded" class="border-t border-[var(--border-color)] px-4 py-4 sm:px-5">
            <div v-if="loading && !loaded" class="flex items-center justify-center gap-2 py-8 text-sm text-[var(--text-muted)]" role="status">
                <Spinner size="sm" />
                {{ t("ide.picker.loading") }}
            </div>
            <div
                v-else-if="error"
                class="rounded-[var(--radius-control)] border border-[var(--status-danger-border,var(--status-danger))] bg-[color-mix(in_srgb,var(--status-danger)_8%,transparent)] px-3 py-3 text-sm text-[var(--status-danger)]"
            >
                <p>{{ error }}</p>
                <Button size="sm" variant="danger" class="mt-3" @click="emit('retry')">
                    {{ t("ide.picker.recoveryRetry") }}
                </Button>
            </div>
            <div v-else-if="!sessions || sessions.length === 0" class="py-8 text-center text-sm text-[var(--text-muted)]">
                {{ t("ide.picker.recoveryEmpty") }}
            </div>
            <div v-else class="space-y-3">
                <article
                    v-for="session in sessions"
                    :key="session.sessionId"
                    class="rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-main)] p-3"
                >
                    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div class="min-w-0">
                            <h3 class="truncate text-sm font-medium text-[var(--text-main)]">
                                {{ session.title || "Session " + session.sessionId }}
                            </h3>
                            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
                                <span>{{ session.profileKey }}</span>
                                <span>{{ formatTimestamp(session.updatedAt) }}</span>
                                <span class="text-[var(--status-warning)]">{{ t("ide.picker.recoveryReason") }}</span>
                            </div>
                        </div>
                        <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                            <select
                                v-model="targets[session.sessionId]"
                                class="nb-ui-control h-8 min-w-0 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--control-surface,var(--bg-input))] px-2.5 text-xs text-[var(--text-main)] sm:w-[240px]"
                                :disabled="actionId === session.sessionId"
                            >
                                <option value="">{{ t("ide.picker.recoveryProject") }}</option>
                                <option
                                    v-for="novel in projects"
                                    :key="novel.projectRoot"
                                    :value="novel.projectRoot"
                                >
                                    {{ novel.title }} · {{ novel.projectRoot }}
                                </option>
                            </select>
                            <Button
                                size="sm"
                                variant="primary"
                                :disabled="actionId === session.sessionId || !targets[session.sessionId]"
                                @click="handleRecover(session, false)"
                            >
                                {{ t("ide.picker.recoveryConfirm") }}
                            </Button>
                            <Button
                                size="sm"
                                variant="secondary"
                                :disabled="actionId === session.sessionId"
                                @click="handleRecover(session, true)"
                            >
                                {{ t("ide.picker.recoveryWorkspaceRoot") }}
                            </Button>
                        </div>
                    </div>
                </article>
                <div v-if="hasMore" class="pt-2 text-center">
                    <Button
                        size="sm"
                        variant="secondary"
                        :loading="loading"
                        icon-class="i-lucide-arrow-down"
                        @click="emit('load-more')"
                    >
                        {{ t("ide.picker.recoveryLoadMore") }}
                    </Button>
                </div>
            </div>
        </div>
    </section>
</template>
