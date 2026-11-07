<script setup lang="ts">
import {Dialog, Field, Input} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {USER_PROFILE_NAME} from "../../shared/profile-tools";
import {useAgentPageText} from "../text";

/** 新建用户级 Profile 的对话框（同名 .md）。 */
const props = withDefaults(defineProps<{
    open: boolean;
    busy?: boolean;
    status?: string;
}>(), {busy: false, status: ""});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "create", name: string): void;
    (e: "edit"): void;
}>();

const text = useAgentPageText();
const name = ref("");
const attempted = ref(false);
watch(() => props.open, (open) => {
    if (!open) return;
    name.value = "";
    attempted.value = false;
}, {immediate: true});

const trimmed = computed(() => name.value.trim());
const valid = computed(() => USER_PROFILE_NAME.test(trimmed.value));
const invalid = computed(() => trimmed.value !== "" && !valid.value);
const hint = computed(() => (valid.value ? text("profiles.create.hint", {name: trimmed.value}) : text("profiles.create.hintEmpty")));
// 打字途中不报错：提交过一次之后才标红，同表单校验的时机。
const error = computed(() => (invalid.value && attempted.value ? text("profiles.create.invalid") : ""));

function submit(): void {
    attempted.value = true;
    if (valid.value) emit("create", trimmed.value);
}
</script>

<template>
    <Dialog
        :open="open"
        size="sm"
        :title="text('profiles.create.title')"
        closable
        :confirm-label="text('profiles.create.confirm')"
        :busy="busy"
        :status="error === '' ? status : error"
        data-profile-new
        @update:open="(value: boolean) => emit('update:open', value)"
        @confirm="submit"
    >
        <Field :label="text('profiles.create.name')" :description="hint" :error="error || status">
            <Input v-model="name" size="sm" autofocus data-profile-new-name @update:model-value="emit('edit')" @keydown.enter.prevent="submit" />
        </Field>
    </Dialog>
</template>
