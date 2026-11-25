<script setup lang="ts">
import {InfoTip, Input} from "@notnotype/nb-ui/components";
import {computed, ref, useId, watch} from "vue";

import {useWebText} from "../text";

/** 一家服务的 API 密钥框（docs/specs/web/settings-page.md 输出 2 到 5、10）。只进不出：已存的密钥不回到浏览器，交出后清空。 */
const props = withDefaults(defineProps<{
    state: "loading" | "set" | "unset";
    /** 服务名，进“清除”按钮的可访问名称。 */
    service: string;
    disabled?: boolean;
    describedBy?: string;
    /** 标签旁说明图标的提示；缺省没有图标。 */
    tip?: string;
    /** 没有密钥时标签行右边（有密钥时是“清除”的位置）写的一句状态，警告色；缺省不写。 */
    notice?: string;
}>(), {disabled: false, describedBy: undefined, tip: undefined, notice: undefined});

const emit = defineEmits<{
    (e: "set", value: string): void;
    (e: "clear"): void;
    /** 框里有没有失焦就会交出的输入；页面据此让“检测”在第一次填写时就能点（点下去先失焦写入）。 */
    (e: "pending", value: boolean): void;
}>();

const text = useWebText();
const id = useId();
const draft = ref("");
const root = ref<HTMLElement | null>(null);
/** 页面在“等着启用”时把焦点放进这家的密钥框（settings-page.md 输出 11）；nb-ui 的 Input 不暴露方法，从根元素里找。 */
defineExpose({focus: () => root.value?.querySelector<HTMLInputElement>("input")?.focus()});

const off = computed(() => props.disabled || props.state === "loading");
const envProblem = computed(() => draft.value.trim().startsWith("env:"));
const placeholder = computed(() => {
    switch (props.state) {
        case "loading": return text("key.loading");
        case "set": return text("key.stored");
        default: return text("key.empty");
    }
});
const describedIds = computed(() => [envProblem.value ? `${id}-problem` : null, props.describedBy ?? null].filter((item) => item !== null).join(" ") || undefined);
const pending = computed(() => !off.value && !envProblem.value && draft.value.trim() !== "");
watch(pending, (value) => emit("pending", value));

/** 交出后清空：回车之后紧接着的失焦读到空框，不会再交一次。 */
function commit(): void {
    const value = draft.value.trim();
    if (value === "" || off.value || envProblem.value) return;
    emit("set", value);
    draft.value = "";
}
</script>

<template>
    <div ref="root" class="api-key-field">
        <div class="api-key-field__head">
            <span class="api-key-field__label"><label :for="`${id}-input`">{{ text("key.label") }}</label><InfoTip v-if="tip !== undefined" :text="tip" /></span>
            <button
                v-if="state === 'set'"
                type="button"
                class="api-key-field__clear nb-ui-focus-ring"
                :disabled="off"
                :aria-label="text('key.clearFor', {provider: service})"
                data-key-clear
                @click="emit('clear')"
            >{{ text("key.clear") }}</button>
            <span v-else-if="notice !== undefined" class="api-key-field__notice" data-key-notice>{{ notice }}</span>
        </div>
        <Input
            :id="`${id}-input`"
            v-model="draft"
            type="password"
            size="sm"
            autocomplete="new-password"
            :placeholder="placeholder"
            :disabled="off"
            :invalid="envProblem"
            :aria-describedby="describedIds"
            data-key-input
            @keydown.enter="commit"
            @focusout="commit"
        />
        <p v-if="envProblem" :id="`${id}-problem`" class="api-key-field__problem" role="alert" data-key-problem>{{ text("key.envUnsupported") }}</p>
    </div>
</template>

<style scoped>
.api-key-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.api-key-field__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
}

.api-key-field__label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}

/* 状态字与“清除”同一格：有没有密钥时互换，标签行高不变。 */
.api-key-field__notice {
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    color: var(--status-warning);
}

.api-key-field__clear {
    padding: 0;
    border: 0;
    background: none;
    font-size: var(--text-xs);
    color: var(--status-danger);
    cursor: pointer;
}

.api-key-field__clear:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.api-key-field__problem {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-danger);
}
</style>
