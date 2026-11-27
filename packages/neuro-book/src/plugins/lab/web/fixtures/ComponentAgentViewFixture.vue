<script setup lang="ts">
/** “AI视图”的夹具：注入 canon 的翻译端口（`canon-text.ts`），放在条目页内容列那么宽的一栏里。 */
import ComponentAgentView from "nbook/plugins/canon/web/components/groups/ComponentAgentView.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof ComponentAgentView>(() => props.input, ["retry"]);
</script>

<template>
    <div class="h-full w-full overflow-y-auto p-6">
        <ComponentAgentView data-lab-subject class="mx-auto max-w-[760px]" v-bind="subject.bindings.value" />
    </div>
</template>
