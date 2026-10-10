<script setup lang="ts">
import {Button, DialogWindow} from "@notnotype/nb-ui/components";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof DialogWindow>(() => props.input, ["request-close"]);
</script>

<template>
    <DialogWindow data-lab-subject v-bind="subject.bindings.value">
        <template v-if="subject.slots.value.default" #default>
            <div class="space-y-3 p-4 text-sm">
                <p>可以拖动标题栏移动窗口；可缩放的场景拖右下角改尺寸，尺寸回写到数据页签。</p>
                <p class="text-[var(--text-muted)]">关闭按钮与 Esc 发出 request-close。</p>
            </div>
        </template>
        <template v-if="subject.slots.value.footer" #footer>
            <div class="flex justify-end gap-2 p-3">
                <Button size="sm" variant="secondary" @click="subject.write('model', 'modelValue', false)">取消</Button>
                <Button size="sm" @click="subject.write('model', 'modelValue', false)">创建</Button>
            </div>
        </template>
    </DialogWindow>
    <LabFixtureControls>
        <Button size="sm" variant="secondary" @click="subject.write('model', 'modelValue', true)">打开窗口</Button>
    </LabFixtureControls>
</template>
