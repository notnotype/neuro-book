<script setup lang="ts">
import LowCodeFieldShell from "../../components/common/low-code-form/LowCodeFieldShell.vue";
import LowCodeTextField from "../../components/common/low-code-form/LowCodeTextField.vue";
import type {LowCodeFieldDto} from "nbook/shared/dto/low-code-form.dto";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(LowCodeFieldShell, () => props.input);

const controlField: LowCodeFieldDto = {
    path: "profile.displayName",
    component: "text",
    label: "显示名称",
    placeholder: "输入名称",
    required: false,
    options: [],
};
</script>

<template>
    <LowCodeFieldShell data-lab-subject class="w-full" v-bind="subject.bindings.value">
        <template v-if="subject.slots.value.actions" #actions>
            <span class="rounded border border-[var(--control-outline)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">操作区</span>
        </template>
        <template v-if="subject.slots.value.default" #default>
            <LowCodeTextField class="w-full" :field="controlField" model-value="章节标题" disabled />
        </template>
    </LowCodeFieldShell>
</template>
