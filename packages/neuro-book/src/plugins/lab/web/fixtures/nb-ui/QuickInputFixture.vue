<script setup lang="ts">
import {ref} from "vue";
import {Button, Dialog, QuickInput} from "@notnotype/nb-ui/components";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof QuickInput>(() => props.input, ["accept", "close", "closed"]);
// 快速输入常从对话框里再打开（例如在“章节属性”里选目标卷），要看两层的叠放，以及 Esc 与外点各关哪一层。
// 宿主对话框不属于场景输入，由控制区打开，任何场景都能叠上去。
const hostOpen = ref(false);

function openOverDialog(): void {
    hostOpen.value = true;
    subject.write("model", "open", true);
}
</script>

<template>
    <Dialog v-model="hostOpen" title="章节属性" size="sm" :show-footer="false">
        <p class="text-sm leading-relaxed">下层的对话框。快速输入关掉之后，焦点应回到这里。</p>
    </Dialog>
    <QuickInput v-bind="subject.bindings.value" data-lab-subject />
    <LabFixtureControls>
        <Button size="sm" variant="secondary" @click="subject.write('model', 'open', true)">打开快速输入</Button>
        <Button size="sm" variant="secondary" @click="openOverDialog">在对话框上打开</Button>
    </LabFixtureControls>
</template>
