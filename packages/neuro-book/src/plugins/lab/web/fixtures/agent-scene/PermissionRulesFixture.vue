<script setup lang="ts">
/** 规则设置页的夹具：规则放在这里，改了就更新，增删改能在 Lab 里点。 */
import {ref} from "vue";

import PermissionRulesPage from "nbook/plugins/agent/web/components/PermissionRulesPage.vue";
import type {Rule} from "nbook/plugins/agent/shared/permissions";

import type {LabSceneInput} from "../../lab-subject";

const props = defineProps<{scene: string; input?: LabSceneInput}>();
const page = (props.input?.props ?? {}) as {rules?: Rule[]; projectRules?: Rule[] | "invalid" | "unavailable"; projectTitle?: string; writable?: boolean; initialEdit?: number | "new"; modeWriteAction?: "deny" | "ask"; readOnlyCommands?: string[]};
const rules = ref<Rule[]>(page.rules ?? []);
const modeWriteAction = ref(page.modeWriteAction ?? "deny");
const readOnlyCommands = ref(page.readOnlyCommands ?? []);
</script>

<template>
    <div class="permission-rules-fixture">
        <PermissionRulesPage
            :rules="rules"
            :project-rules="page.projectRules ?? null"
            :project-title="page.projectTitle ?? null"
            :writable="page.writable ?? true"
            :initial-edit="page.initialEdit ?? null"
            :mode-write-action="modeWriteAction"
            :read-only-commands="readOnlyCommands"
            @change="rules = $event"
            @mode-write-action="modeWriteAction = $event"
            @read-only-commands="readOnlyCommands = $event"
        />
    </div>
</template>

<style scoped>
.permission-rules-fixture {
    padding: 16px;
}
</style>
