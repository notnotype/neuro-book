<script setup lang="ts">
import {Input} from "@notnotype/nb-ui/components";
import {computed, ref, useId} from "vue";

import {useWebText} from "../text";

/** 一家服务的 API 密钥框（docs/specs/web/settings-page.md 输出 2 到 5、10）。只进不出：已存的密钥不回到浏览器，交出后清空。 */
const props = withDefaults(defineProps<{
    state: "loading" | "set" | "unset";
    disabled?: boolean;
    describedBy?: string;
}>(), {disabled: false, describedBy: undefined});

const emit = defineEmits<{
    (e: "set", value: string): void;
    (e: "clear"): void;
}>();

const text = useWebText();
const id = useId();
const draft = ref("");

const off = computed(() => props.disabled || props.state === "loading");
const envProblem = computed(() => draft.value.trim().startsWith("env:"));
const placeholder = computed(() => {
    switch (props.state) {
        case "loading": return text("key.loading");
        case "set": return text("key.stored");
        default: return text("key.empty");
    }
});
const describedBy = computed(() => [envProblem.value ? `${id}-problem` : null, props.describedBy ?? null].filter((item) => item !== null).join(" ") || undefined);

/** 交出后清空：回车之后紧接着的失焦读到空框，不会再交一次。 */
function commit(): void {
    const value = draft.value.trim();
    if (value === "" || off.value || envProblem.value) return;
    emit("set", value);
    draft.value = "";
}
</script>

<template>
    <div class="api-key-field">
        <div class="api-key-field__head">
            <label :for="`${id}-input`">{{ text("key.label") }}</label>
            <button v-if="state === 'set'" type="button" class="api-key-field__clear nb-ui-focus-ring" :disabled="off" data-key-clear @click="emit('clear')">{{ text("key.clear") }}</button>
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
            :aria-describedby="describedBy"
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
