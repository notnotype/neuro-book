<script setup lang="ts">
/** 状态栏的注册表是运行期能力，场景数据只给 ctx。 */
import {AgentStatusBar} from "@notnotype/nb-agent-ui/lab";

import {useLabSubject, type LabFixtureProps} from "../../lab-subject";
import {labAgentRegistry, provideLabAgentHost} from "./host";

const props = defineProps<LabFixtureProps>();

provideLabAgentHost();
const subject = useLabSubject<typeof AgentStatusBar>(() => props.input, []);
const registry = labAgentRegistry();
</script>

<template>
    <AgentStatusBar data-lab-subject class="w-full" v-bind="subject.bindings.value" :registry="registry" />
</template>
