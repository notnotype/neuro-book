<script setup lang="ts">
/**
 * 还原的对话框（docs/specs/canon/author-ui.md 输出 22、29、30）：预览中、没有依赖（带来的变化与“还原”）、有依赖（依赖它的修订
 * 从新到旧与“连同这些一起还原”）、不能还原（只写原因）。受控：阶段、预览的结果、原因都由宿主给（`revert.ts`）；结果回来之前
 * 宿主让 `saving` 为真，对话框不关、按钮不可用。
 */
import {computed} from "vue";

import {Button, Dialog} from "@notnotype/nb-ui/components";

import type {RevertPhase} from "../../revert";
import {useCanonText} from "../../text";

const props = withDefaults(defineProps<{
    open: boolean;
    /** 原来那次修订的标题；还不知道时为空。 */
    title?: string;
    phase: RevertPhase;
    /** 没有依赖时：带来的变化，一句一行。 */
    impact?: readonly string[];
    /** 有依赖时：依赖它的修订的标题，从新到旧；还没读到的为 null。 */
    dependents?: readonly (string | null)[];
    /** 依赖的修订里没列出来的条数。 */
    moreDependents?: number;
    /** 不能还原的原因，或世界写不了的原因；没有时为空。 */
    reason?: string;
    /** 还原被拒收的原因（`role="alert"`）。 */
    error?: string;
    /** 结局不明：给“再查一次”。 */
    recheck?: boolean;
    saving?: boolean;
}>(), {title: "", impact: () => [], dependents: () => [], moreDependents: 0, reason: "", error: "", recheck: false, saving: false});

const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    (event: "confirm"): void;
    (event: "recheck"): void;
    /** 关闭的动画结束了（nb-ui `Dialog` 的 `closed`）。 */
    (event: "closed"): void;
}>();

const text = useCanonText();
const confirmable = computed(() => (props.phase === "ready" || props.phase === "dependents") && props.reason === "" && !props.saving);
</script>

<template>
    <Dialog
        :open="props.open"
        size="md"
        :title="props.title === '' ? text('revert.titleUnknown') : text('revert.title', {title: props.title})"
        :busy="props.saving"
        :close-on-request="!props.saving"
        @update:open="(value: boolean) => emit('update:open', value)"
        @closed="emit('closed')"
    >
        <div class="flex flex-col gap-2 text-[length:var(--text-sm)]" data-revert-dialog :data-phase="props.phase">
            <p v-if="props.phase === 'previewing'" role="status" class="text-[var(--text-muted)]">{{ text("edit.previewing") }}</p>
            <template v-else-if="props.phase === 'ready'">
                <p class="text-[var(--text-secondary)]">{{ text("revert.impact") }}</p>
                <ul class="m-0 list-none p-0 text-[var(--text-main)]" data-revert-impact>
                    <li v-for="(line, index) in props.impact" :key="index">{{ line }}</li>
                </ul>
            </template>
            <template v-else-if="props.phase === 'dependents'">
                <p class="text-[var(--text-secondary)]">{{ text("revert.dependents") }}</p>
                <ul class="m-0 list-disc pl-5 text-[var(--text-main)]" data-revert-dependents>
                    <li v-for="(title, index) in props.dependents" :key="index">{{ title ?? text("entries.loading") }}</li>
                    <li v-if="props.moreDependents > 0" class="text-[var(--text-muted)]">{{ text("revert.moreDependents", {count: props.moreDependents}) }}</li>
                </ul>
            </template>
            <p v-if="props.reason !== ''" :role="props.phase === 'blocked' ? undefined : 'status'" class="text-[var(--text-secondary)]" data-revert-reason>{{ props.reason }}</p>
            <p v-if="props.error !== ''" role="alert" class="flex flex-wrap items-center gap-2 text-[var(--status-danger)]">
                {{ props.error }}
                <Button v-if="props.recheck" size="sm" variant="ghost" @click="emit('recheck')">{{ text("failure.recheck") }}</Button>
            </p>
        </div>
        <template #footer="{cancel}">
            <Button variant="ghost" :disabled="props.saving" @click="cancel()">{{ text(props.phase === "blocked" ? "notice.close" : "edit.cancel") }}</Button>
            <Button variant="primary" v-if="props.phase !== 'blocked'" :disabled="!confirmable" @click="emit('confirm')">{{ text(props.phase === "dependents" ? "revert.withDependents" : "revert.confirm") }}</Button>
        </template>
    </Dialog>
</template>
