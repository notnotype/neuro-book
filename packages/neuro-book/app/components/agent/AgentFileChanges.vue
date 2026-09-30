<script setup lang="ts">
import {computed, ref} from "vue";

type FileChange = {path: string; added: number | null; removed: number | null};

const props = withDefaults(defineProps<{
    files: FileChange[];
    limit?: number;
}>(), {
    limit: 5,
});

const emit = defineEmits<{
    (e: "open", path: string): void;
}>();

const {t} = useI18n();

const showAll = ref(false);
const visibleFiles = computed(() => showAll.value ? props.files : props.files.slice(0, props.limit));
const hiddenCount = computed(() => Math.max(0, props.files.length - props.limit));

function segments(path: string): string[] {
    return path.split("/").filter((segment) => segment !== "");
}

/** 只写文件名；同一轮有同名文件时带上上级目录，否则两枚标签无法区分。 */
const labels = computed(() => {
    const counts = new Map<string, number>();
    for (const file of props.files) {
        const name = segments(file.path).at(-1) ?? file.path;
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return new Map(props.files.map((file) => {
        const parts = segments(file.path);
        const name = parts.at(-1) ?? file.path;
        return [file.path, (counts.get(name) ?? 0) > 1 ? parts.slice(-2).join("/") : name];
    }));
});

// 一侧为 0 而另一侧有改动时，0 那一侧只是噪音。
function showAdded(file: FileChange): boolean {
    return file.added !== null && (file.added > 0 || !(file.removed !== null && file.removed > 0));
}

function showRemoved(file: FileChange): boolean {
    return file.removed !== null && (file.removed > 0 || !(file.added !== null && file.added > 0));
}
</script>

<template>
    <div class="agent-file-changes">
        <span class="agent-file-changes__head">
            <span class="i-lucide-file-diff agent-file-changes__icon" aria-hidden="true" />{{ t("agentView.fileChanges.title", {count: props.files.length}) }}
        </span>
        <button
            v-for="file in visibleFiles"
            :key="file.path"
            type="button"
            class="agent-file-changes__chip"
            :title="file.path"
            @click="emit('open', file.path)"
        >
            <span class="agent-file-changes__name">{{ labels.get(file.path) }}</span>
            <span v-if="showAdded(file)" class="agent-file-changes__added">+{{ file.added }}</span>
            <span v-if="showRemoved(file)" class="agent-file-changes__removed">-{{ file.removed }}</span>
        </button>
        <button
            v-if="hiddenCount > 0"
            type="button"
            class="agent-file-changes__chip agent-file-changes__more"
            :aria-expanded="showAll"
            :title="showAll ? undefined : t('agentView.fileChanges.showRest', {count: hiddenCount})"
            @click="showAll = !showAll"
        >
            {{ showAll ? t("agentView.fileChanges.collapse") : `+${hiddenCount}` }}
        </button>
    </div>
</template>

<style scoped>
/*
 * 轮末的一行文件条，注意力低于回复气泡：没有外框与底色，标签只有细分隔线；
 * 宽度随内容，宽屏下不拉满整行。
 */
.agent-file-changes {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
    font-size: 11px;
}

.agent-file-changes__head {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-right: 2px;
    color: var(--text-muted);
    white-space: nowrap;
}

.agent-file-changes__icon {
    flex-shrink: 0;
    width: 12px;
    height: 12px;
}

.agent-file-changes__chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
    height: 20px;
    padding: 0 6px;
    border: var(--border-w, 1px) solid var(--divider);
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    transition: background-color var(--motion-fast) var(--ease-standard), color var(--motion-fast) var(--ease-standard);
}

.agent-file-changes__chip:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.agent-file-changes__name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.agent-file-changes__added,
.agent-file-changes__removed {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
}

.agent-file-changes__added {
    color: var(--status-success);
}

.agent-file-changes__removed {
    color: var(--status-danger);
}

.agent-file-changes__more {
    color: var(--text-muted);
}
</style>
