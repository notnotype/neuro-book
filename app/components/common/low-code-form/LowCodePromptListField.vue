<script setup lang="ts">
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";

type PromptEntry = {
    id: string;
    title: string;
    enabled: boolean;
    content: string;
    position: PromptEntryPosition;
};

type PromptEntryPosition = "before" | "after";

const props = defineProps<{
    field: LowCodeFieldDto;
    modelValue?: LowCodeJsonValue;
    disabled?: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: LowCodeJsonValue): void;
}>();

/** 将不可信的表单 JSON 收敛为提示词条目。 */
function entries(): PromptEntry[] {
    if (!Array.isArray(props.modelValue)) {
        return [];
    }
    return props.modelValue.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return [];
        }
        const id = typeof value.id === "string" ? value.id : "";
        const title = typeof value.title === "string" ? value.title : "";
        const content = typeof value.content === "string" ? value.content : "";
        if (!id) {
            return [];
        }
        return [{
            id,
            title,
            content,
            enabled: value.enabled !== false,
            position: value.position === "after" ? "after" : "before",
        }];
    });
}

/** 更新单个条目并保持其余顺序不变。 */
function updateEntry(id: string, patch: Partial<PromptEntry>): void {
    const next = entries();
    const index = next.findIndex((entry) => entry.id === id);
    const current = next[index];
    if (!current) {
        return;
    }
    next[index] = {...current, ...patch};
    emit("update:modelValue", next);
}

/** 在指定开放槽位末尾新增空白提示词条目。 */
function addEntry(position: PromptEntryPosition): void {
    emit("update:modelValue", [
        ...entries(),
        {
            id: crypto.randomUUID(),
            title: `提示词 ${entries().length + 1}`,
            enabled: true,
            content: "",
            position,
        },
    ]);
}

/** 删除指定提示词条目。 */
function removeEntry(id: string): void {
    emit("update:modelValue", entries().filter((entry) => entry.id !== id));
}

/** 将条目在当前开放槽位内向上或向下移动一格。 */
function moveEntry(id: string, offset: -1 | 1): void {
    const next = entries();
    const current = next.find((entry) => entry.id === id);
    if (!current) {
        return;
    }
    const group = next.filter((entry) => entry.position === current.position);
    const groupIndex = group.findIndex((entry) => entry.id === id);
    const target = group[groupIndex + offset];
    if (!target) {
        return;
    }
    const currentIndex = next.findIndex((entry) => entry.id === id);
    const targetIndex = next.findIndex((entry) => entry.id === target.id);
    [next[currentIndex], next[targetIndex]] = [next[targetIndex]!, next[currentIndex]!];
    emit("update:modelValue", next);
}

/** 把条目移动到另一个开放槽位，并放到目标槽位末尾。 */
function moveToPosition(id: string, position: PromptEntryPosition): void {
    const next = entries();
    const current = next.find((entry) => entry.id === id);
    if (!current || current.position === position) {
        return;
    }
    emit("update:modelValue", [
        ...next.filter((entry) => entry.id !== id),
        {...current, position},
    ]);
}

/** 返回指定开放槽位内的条目。 */
function groupEntries(position: PromptEntryPosition): PromptEntry[] {
    return entries().filter((entry) => entry.position === position);
}
</script>

<template>
    <!-- 带固定结构锚点的双槽提示词条目 -->
    <div class="space-y-3">
        <div class="rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--text-secondary)]">
            下方顺序就是最终 System Prompt 的相对顺序。固定结构的位置不可移动；自定义条目可在前置与末尾槽位之间切换，标记为“已禁用”的条目不会进入最终提示词。
        </div>

        <div class="flex items-center gap-2 px-1 text-[11px] font-semibold text-[var(--text-secondary)]"><span class="i-lucide-arrow-up-to-line h-3.5 w-3.5 text-[var(--accent)]"></span>前置提示词<span class="font-normal text-[var(--text-muted)]">位于人设、特色策略和协议之前</span></div>
        <div v-if="groupEntries('before').length === 0" class="rounded-lg border border-dashed border-[var(--border-color)] px-3 py-4 text-center text-xs text-[var(--text-muted)]">暂无前置提示词</div>
        <article v-for="(entry, index) in groupEntries('before')" :key="entry.id" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/35 p-3">
            <div class="flex items-center gap-2">
                <button type="button" class="h-7 w-7 text-[var(--text-muted)] disabled:opacity-30" :disabled="props.disabled || index === 0" title="上移" @click="moveEntry(entry.id, -1)"><span class="i-lucide-arrow-up h-3.5 w-3.5"></span></button>
                <button type="button" class="h-7 w-7 text-[var(--text-muted)] disabled:opacity-30" :disabled="props.disabled || index === groupEntries('before').length - 1" title="下移" @click="moveEntry(entry.id, 1)"><span class="i-lucide-arrow-down h-3.5 w-3.5"></span></button>
                <input :value="entry.title" :disabled="props.disabled" class="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent)]" placeholder="条目标题" @input="updateEntry(entry.id, {title: ($event.target as HTMLInputElement).value})" />
                <select :value="entry.position" :disabled="props.disabled" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-secondary)]" @change="moveToPosition(entry.id, ($event.target as HTMLSelectElement).value as PromptEntryPosition)"><option value="before">前置</option><option value="after">末尾</option></select>
                <button type="button" class="inline-flex h-8 min-w-20 items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors disabled:opacity-50" :class="entry.enabled ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)]'" :disabled="props.disabled" :aria-pressed="entry.enabled" :title="entry.enabled ? '点击禁用此条目' : '点击启用此条目'" @click="updateEntry(entry.id, {enabled: !entry.enabled})"><span :class="entry.enabled ? 'i-lucide-toggle-right' : 'i-lucide-toggle-left'" class="h-4 w-4"></span>{{ entry.enabled ? '已启用' : '已禁用' }}</button>
                <button type="button" class="h-7 w-7 text-[var(--status-danger)] disabled:opacity-30" :disabled="props.disabled" title="删除" @click="removeEntry(entry.id)"><span class="i-lucide-trash-2 h-3.5 w-3.5"></span></button>
            </div>
            <textarea :value="entry.content" :disabled="props.disabled" class="mt-2 min-h-24 w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-xs leading-5 text-[var(--text-main)] outline-none focus:border-[var(--accent)]" placeholder="输入此条提示词正文" @input="updateEntry(entry.id, {content: ($event.target as HTMLTextAreaElement).value})"></textarea>
        </article>
        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="props.disabled" @click="addEntry('before')"><span class="i-lucide-plus h-3.5 w-3.5"></span>新增前置提示词</button>

        <div class="rounded-xl border border-[var(--status-info-border)] bg-[var(--status-info-bg)]/55 px-3 py-3">
            <div class="flex items-center gap-2 text-xs font-semibold text-[var(--text-main)]"><span class="i-lucide-lock-keyhole h-3.5 w-3.5 text-[var(--status-info)]"></span>固定 Profile 结构</div>
            <div class="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--text-secondary)]"><span class="rounded-md border border-[var(--border-color)] px-2 py-1">人设预设</span><span class="rounded-md border border-[var(--border-color)] px-2 py-1">特色设置</span><span class="rounded-md border border-[var(--border-color)] px-2 py-1">身份与工具协议</span><span class="rounded-md border border-[var(--border-color)] px-2 py-1">输出合同</span></div>
            <p class="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">内容会随当前 Profile 和特色设置动态生成；位置固定，不能被自定义条目删除或重排。</p>
        </div>

        <div class="flex items-center gap-2 px-1 text-[11px] font-semibold text-[var(--text-secondary)]"><span class="i-lucide-arrow-down-to-line h-3.5 w-3.5 text-[var(--accent)]"></span>末尾补充提示词<span class="font-normal text-[var(--text-muted)]">位于固定结构之后，仍受工具权限与输出合同约束</span></div>
        <div v-if="groupEntries('after').length === 0" class="rounded-lg border border-dashed border-[var(--border-color)] px-3 py-4 text-center text-xs text-[var(--text-muted)]">暂无末尾补充提示词</div>
        <article v-for="(entry, index) in groupEntries('after')" :key="entry.id" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/35 p-3">
            <div class="flex items-center gap-2">
                <button type="button" class="h-7 w-7 text-[var(--text-muted)] disabled:opacity-30" :disabled="props.disabled || index === 0" title="上移" @click="moveEntry(entry.id, -1)"><span class="i-lucide-arrow-up h-3.5 w-3.5"></span></button>
                <button type="button" class="h-7 w-7 text-[var(--text-muted)] disabled:opacity-30" :disabled="props.disabled || index === groupEntries('after').length - 1" title="下移" @click="moveEntry(entry.id, 1)"><span class="i-lucide-arrow-down h-3.5 w-3.5"></span></button>
                <input :value="entry.title" :disabled="props.disabled" class="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-xs text-[var(--text-main)] outline-none focus:border-[var(--accent)]" placeholder="条目标题" @input="updateEntry(entry.id, {title: ($event.target as HTMLInputElement).value})" />
                <select :value="entry.position" :disabled="props.disabled" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-secondary)]" @change="moveToPosition(entry.id, ($event.target as HTMLSelectElement).value as PromptEntryPosition)"><option value="before">前置</option><option value="after">末尾</option></select>
                <button type="button" class="inline-flex h-8 min-w-20 items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors disabled:opacity-50" :class="entry.enabled ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)]'" :disabled="props.disabled" :aria-pressed="entry.enabled" :title="entry.enabled ? '点击禁用此条目' : '点击启用此条目'" @click="updateEntry(entry.id, {enabled: !entry.enabled})"><span :class="entry.enabled ? 'i-lucide-toggle-right' : 'i-lucide-toggle-left'" class="h-4 w-4"></span>{{ entry.enabled ? '已启用' : '已禁用' }}</button>
                <button type="button" class="h-7 w-7 text-[var(--status-danger)] disabled:opacity-30" :disabled="props.disabled" title="删除" @click="removeEntry(entry.id)"><span class="i-lucide-trash-2 h-3.5 w-3.5"></span></button>
            </div>
            <textarea :value="entry.content" :disabled="props.disabled" class="mt-2 min-h-24 w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-xs leading-5 text-[var(--text-main)] outline-none focus:border-[var(--accent)]" placeholder="输入此条提示词正文" @input="updateEntry(entry.id, {content: ($event.target as HTMLTextAreaElement).value})"></textarea>
        </article>
        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="props.disabled" @click="addEntry('after')"><span class="i-lucide-plus h-3.5 w-3.5"></span>新增末尾提示词</button>

        <div v-if="entries().length === 0" class="text-center text-[11px] text-[var(--text-muted)]">当前没有自定义提示词；最终提示词仍包含上方固定 Profile 结构。</div>
    </div>
</template>
