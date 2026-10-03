<script setup lang="ts">
import BrowserHostFailurePage from "../../components/workbench/BrowserHostFailurePage.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof BrowserHostFailurePage>(() => props.input, ["retry", "reload"]);
</script>

<template>
    <div class="h-full overflow-auto">
        <BrowserHostFailurePage data-lab-subject v-bind="subject.bindings.value" />
    </div>
</template>
