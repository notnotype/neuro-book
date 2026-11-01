<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {nextTick, ref} from "vue";

import type {SnapshotProvider} from "../../shared/contracts";
import type {CheckState} from "../models-store";
import {checkKey} from "../models-store";
import {useModelsText} from "../text";

/**
 * “服务商与模型”页的左栏（docs/specs/models/settings-pages.md 输出 1）：顶上“全部模型”，下面是添加过的服务商，最后“添加服务商”。
 * 选择照设置窗口左栏：当前项 `aria-current`，上下键与 Home、End 在项之间移动并选中，只有当前项在 Tab 序列里。
 */
const props = withDefaults(defineProps<{
    providers: readonly SnapshotProvider[];
    /** 当前项：服务商 id，或 `"all"`（全部模型）。 */
    current: string;
    checks?: ReadonlyMap<string, CheckState>;
    disabled?: boolean;
}>(), {checks: () => new Map(), disabled: false});

const emit = defineEmits<{
    (e: "select", id: string): void;
    (e: "add"): void;
}>();

const text = useModelsText();
const root = ref<HTMLElement | null>(null);

const total = (): number => props.providers.reduce((sum, provider) => sum + provider.models.filter((model) => model.enabled).length, 0);

/** 每项的第二行：密钥的问题先说，再说检测失败，都没有时写启用了几个模型。 */
function status(provider: SnapshotProvider): {readonly text: string; readonly tone: "muted" | "warning" | "error"} {
    if (provider.key.kind === "none" && provider.auth !== "none") return {text: text("rail.keyMissing"), tone: "warning"};
    if (provider.key.kind === "env" && !provider.key.found) return {text: text("rail.envMissing"), tone: "error"};
    if (provider.models.some((model) => {
        const state = props.checks.get(checkKey(provider.id, model.id));
        return state?.status === "done" && !state.result.ok;
    })) return {text: text("rail.checkFailed"), tone: "error"};
    return {text: text("rail.models", {count: provider.models.filter((model) => model.enabled).length}), tone: "muted"};
}

function onKeydown(event: KeyboardEvent): void {
    // 只管左栏的项：“添加服务商”按钮上的方向键不算左栏导航。
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-provider-rail-item")) return;
    const ids = ["all", ...props.providers.map((provider) => provider.id)];
    const at = ids.indexOf(props.current);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(ids.length - 1, at + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, at - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    if (next === null) return;
    event.preventDefault();
    emit("select", ids[next]!);
    void nextTick(() => root.value?.querySelector<HTMLElement>("[aria-current='page']")?.focus());
}
</script>

<template>
    <nav ref="root" class="provider-rail" :aria-label="text('rail.label')" @keydown="onKeydown">
        <button
            type="button"
            class="provider-rail__item nb-ui-focus-ring-inset"
            :aria-current="current === 'all' ? 'page' : undefined"
            :tabindex="current === 'all' ? 0 : -1"
            data-provider-rail-item="all"
            @click="emit('select', 'all')"
        >
            <span class="i-lucide-layers provider-rail__icon" aria-hidden="true" />
            <span class="provider-rail__text">
                <span class="provider-rail__name">{{ text("rail.all") }}</span>
                <span class="provider-rail__status">{{ text("rail.available", {count: total()}) }}</span>
            </span>
        </button>
        <div class="provider-rail__divider" />
        <div class="provider-rail__list">
            <button
                v-for="provider in providers"
                :key="provider.id"
                type="button"
                class="provider-rail__item nb-ui-focus-ring-inset"
                :aria-current="provider.id === current ? 'page' : undefined"
                :tabindex="provider.id === current ? 0 : -1"
                :data-provider-rail-item="provider.id"
                @click="emit('select', provider.id)"
            >
                <span :class="provider.kind === 'catalog' ? 'i-lucide-cloud' : 'i-lucide-server'" class="provider-rail__icon" aria-hidden="true" />
                <span class="provider-rail__text">
                    <span class="provider-rail__name">{{ provider.name }}</span>
                    <span :class="`provider-rail__status provider-rail__status--${status(provider).tone}`">{{ status(provider).text }}</span>
                </span>
            </button>
        </div>
        <Button size="sm" variant="ghost" icon-class="i-lucide-plus" block :disabled="disabled" data-provider-add @click="emit('add')">{{ text("rail.add") }}</Button>
    </nav>
</template>

<style scoped>
.provider-rail {
    display: flex;
    width: 164px;
    flex-shrink: 0;
    flex-direction: column;
    gap: var(--space-1);
    padding: 0 var(--space-3) 0 var(--space-2);
    overflow-y: auto;
    border-right: var(--border-w) solid var(--divider);
}

.provider-rail__divider {
    height: var(--border-w);
    margin: var(--space-1) var(--space-3);
    background: var(--divider);
}

.provider-rail__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.provider-rail__item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
}

/* 设置窗口是玻璃面：悬停与当前项用半透明叠色，同窗口左栏，不用层级轴的不透明色。 */
.provider-rail__item:hover {
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}

.provider-rail__item[aria-current="page"] {
    background: var(--overlay-item-active);
}

.provider-rail__icon {
    flex-shrink: 0;
    color: var(--text-muted);
}

.provider-rail__text {
    display: flex;
    min-width: 0;
    flex-direction: column;
}

.provider-rail__name {
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.provider-rail__status {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.provider-rail__status--warning {
    color: var(--status-warning);
}

.provider-rail__status--error {
    color: var(--status-danger);
}
</style>
