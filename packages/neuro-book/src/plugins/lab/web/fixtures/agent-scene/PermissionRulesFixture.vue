<script setup lang="ts">
/** 规则设置页的夹具：规则放在这里，改了就更新，增删改能在 Lab 里点。 */
import {ref} from "vue";

import PermissionRulesPage from "nbook/plugins/agent/web/components/PermissionRulesPage.vue";
import type {Rule} from "nbook/plugins/agent/shared/permissions";

import type {LabSceneInput} from "../../lab-subject";

const props = defineProps<{scene: string; input?: LabSceneInput}>();
const page = (props.input?.props ?? {}) as {rules?: Rule[]; projectRules?: Rule[] | "invalid"; projectTitle?: string; writable?: boolean; initialEdit?: number | "new"};
const rules = ref<Rule[]>(page.rules ?? []);
</script>

<template>
    <div class="permission-rules-fixture">
        <PermissionRulesPage
            :rules="rules"
            :project-rules="page.projectRules ?? null"
            :project-title="page.projectTitle ?? null"
            :writable="page.writable ?? true"
            :initial-edit="page.initialEdit ?? null"
            @change="rules = $event"
        />
    </div>
</template>

<style scoped>
.permission-rules-fixture {
    padding: 16px;
}
</style>
