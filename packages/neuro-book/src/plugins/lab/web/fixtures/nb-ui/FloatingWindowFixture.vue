<script setup lang="ts">
import {Button, FloatingWindow} from "@notnotype/nb-ui/components";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();
// 关闭与缩放由组件自己发 `update:open`、`update:width`、`update:height`，model 层回写；重新打开靠控制区的按钮。
const subject = useLabSubject<typeof FloatingWindow>(() => props.input, ["confirm", "request-close", "closed"]);
/** 没有标题栏的窗口：正文自己画标题行、标成拖动区域，右端给角上的关闭按钮让位（FloatingWindow.md 的“布局”）。 */
const headerless = (): boolean => props.scene === "headerless";
</script>

<template>
    <FloatingWindow v-bind="subject.bindings.value">
        <template v-if="subject.slots.value.default" #default>
            <div class="space-y-3 text-sm">
                <div v-if="headerless()" class="flex items-center gap-2 font-semibold" :style="{paddingRight: 'calc(var(--nb-dialog-close-room) - var(--panel-p))'}" data-dialog-drag>
                    <span class="i-lucide-images"></span>
                    <span>素材</span>
                </div>
                <p>按住留白或标题栏拖动窗口；点窗口外面不关。</p>
                <p class="text-[var(--text-muted)]">关闭、缩放都记在事件页签。</p>
            </div>
        </template>
        <template v-if="subject.slots.value.footer" #footer>
            <Button variant="secondary" @click="subject.write('model', 'open', false)">取消</Button>
            <Button @click="subject.write('model', 'open', false)">创建</Button>
        </template>
    </FloatingWindow>
    <LabFixtureControls>
        <Button size="sm" variant="secondary" @click="subject.write('model', 'open', true)">打开窗口</Button>
    </LabFixtureControls>
</template>
