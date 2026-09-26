<script setup lang="ts">
import Dropdown from "nbook/app/components/common/Dropdown.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof Dropdown>(() => props.input);
</script>

<template>
    <div class="flex h-full min-h-0 w-full justify-center bg-[var(--panel-surface)]">
        <Dropdown v-bind="subject.bindings.value">
            <template v-if="subject.slots.value.default" #default>
                <button data-lab-subject type="button" class="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-sm text-[var(--text-main)]">
                    操作菜单
                    <span class="i-lucide-chevron-down h-3.5 w-3.5" aria-hidden="true"></span>
                </button>
            </template>
        </Dropdown>
    </div>
</template>
