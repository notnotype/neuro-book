<script setup lang="ts">
import {ContextMenu} from "@notnotype/nb-ui/components";

import LabFixtureControls from "../../LabFixtureControls.vue";

import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();
// 右键菜单是宿主在指针处打开的：这块区域扮演宿主，右键时把坐标写进输入、打开菜单；关闭由组件发 `update:open`，model 层回写。
const subject = useLabSubject<typeof ContextMenu>(() => props.input, ["request-close", "closed"]);

function open(event: MouseEvent): void {
    subject.write("props", "x", event.clientX);
    subject.write("props", "y", event.clientY);
    subject.write("model", "open", true);
}
</script>

<template>
    <div class="h-full w-full" @contextmenu.prevent="open">
        <ContextMenu v-bind="subject.bindings.value" />
    </div>
    <LabFixtureControls>
        <span class="text-xs text-[var(--text-secondary)]">在舞台上点右键打开菜单</span>
    </LabFixtureControls>
</template>
