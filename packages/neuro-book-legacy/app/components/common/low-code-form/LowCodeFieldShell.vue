<script setup lang="ts">
import type {LowCodeFieldDto, LowCodeFormIssueDto} from "nbook/shared/dto/low-code-form.dto";

const props = withDefaults(defineProps<{
    field: LowCodeFieldDto;
    issues?: LowCodeFormIssueDto[];
}>(), {
    issues: () => [],
});
</script>

<template>
    <!-- 低代码字段容器：统一 label、说明、错误和右侧扩展操作。 -->
    <div class="space-y-1.5">
        <div class="flex min-h-6 items-start justify-between gap-3">
            <div class="min-w-0">
                <label class="text-xs font-medium text-[var(--text-secondary)]">
                    {{ props.field.label }}
                    <span v-if="props.field.required" class="text-[var(--status-danger)]">*</span>
                </label>
                <p v-if="props.field.description" class="mt-0.5 text-[11px] leading-4 text-[var(--text-muted)]">{{ props.field.description }}</p>
            </div>
            <slot name="actions"></slot>
        </div>

        <slot></slot>

        <div v-if="props.issues.length" class="space-y-1">
            <p v-for="issue in props.issues" :key="`${issue.code ?? 'issue'}:${issue.message}`" class="text-[11px] leading-4" :class="issue.severity === 'warning' ? 'text-[var(--status-warning)]' : 'text-[var(--status-danger)]'">
                {{ issue.message }}
            </p>
        </div>
    </div>
</template>
