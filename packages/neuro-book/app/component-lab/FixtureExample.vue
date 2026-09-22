<script setup lang="ts">
/**
 * FixtureExample - Component Lab 典型规范示范零件
 *
 * 作为 Component Lab 规范指南中的标准范例：
 * 1. 严格遵循组件规范（仅通过 props/emits/slots 交互，无隐藏通道）；
 * 2. 消费标准主题语义变量（--panel-surface, --bg-panel, --border-color, --text-main 等）；
 * 3. 具备完整的无障碍属性（role, aria-pressed, keyboard focus ring）；
 * 4. 具备自适应响应式能力（自适应 390px 窄屏与大屏）。
 */
export interface FixtureExampleProps {
    title: string;
    description?: string;
    status?: "ready" | "busy" | "warning";
    count?: number;
    active?: boolean;
    disabled?: boolean;
}

const props = withDefaults(defineProps<FixtureExampleProps>(), {
    description: "",
    status: "ready",
    count: 0,
    active: false,
    disabled: false,
});

const emit = defineEmits<{
    (e: "toggle", active: boolean): void;
    (e: "action", actionId: string): void;
}>();

function handleToggle(): void {
    if (props.disabled) return;
    emit("toggle", !props.active);
}

function handleAction(id: string): void {
    if (props.disabled) return;
    emit("action", id);
}
</script>

<template>
    <div
        class="fixture-example-card flex w-full flex-col gap-3 rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 text-[var(--text-main)] transition-colors [transition-duration:var(--motion-fast)] motion-reduce:transition-none shadow-xs"
        :class="[
            props.active ? 'ring-2 ring-[var(--accent-main)]/50 border-[var(--accent-main)]' : '',
            props.disabled ? 'opacity-50 pointer-events-none' : '',
        ]"
    >
        <!-- 头部：标题、状态指示徽标与插槽 -->
        <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
                <span
                    class="h-2.5 w-2.5 shrink-0 rounded-full"
                    :class="{
                        'bg-[var(--status-success)]': props.status === 'ready',
                        'bg-[var(--accent-main)] animate-pulse': props.status === 'busy',
                        'bg-[var(--status-warning)]': props.status === 'warning',
                    }"
                    aria-hidden="true"
                />
                <h3 class="truncate text-sm font-semibold text-[var(--text-main)]">
                    {{ props.title }}
                </h3>
            </div>

            <div class="flex shrink-0 items-center gap-2">
                <span
                    v-if="props.count > 0"
                    class="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]"
                >
                    {{ props.count }}
                </span>
                <slot name="extra" />
            </div>
        </div>

        <!-- 描述正文（响应式截断与折行） -->
        <p
            v-if="props.description"
            class="text-xs leading-5 text-[var(--text-secondary)] line-clamp-2"
        >
            {{ props.description }}
        </p>

        <!-- 底部操作栏：主开关与操作按钮 -->
        <div class="flex items-center justify-between gap-2 border-t border-[var(--divider)] pt-3">
            <button
                type="button"
                role="switch"
                :aria-checked="props.active"
                class="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border-color)] px-2.5 text-xs font-medium transition-colors hover:bg-[var(--bg-hover)] cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]"
                :class="props.active ? 'bg-[var(--accent-main)] text-[var(--text-inverse)] border-transparent' : 'bg-[var(--panel-surface)] text-[var(--text-main)]'"
                @click="handleToggle"
            >
                <span
                    class="h-3 w-3 shrink-0"
                    :class="props.active ? 'i-lucide-check' : 'i-lucide-circle'"
                    aria-hidden="true"
                />
                <span>{{ props.active ? "已启用" : "已禁用" }}</span>
            </button>

            <div class="flex items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-7 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2.5 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]"
                    @click="handleAction('inspect')"
                >
                    检视
                </button>
                <button
                    type="button"
                    class="inline-flex h-7 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2.5 text-xs text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]"
                    @click="handleAction('refresh')"
                >
                    刷新
                </button>
            </div>
        </div>
    </div>
</template>
