<script setup lang="ts">
import {Button, Dialog} from "@notnotype/nb-ui/components";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();
// 关闭由组件自己发 `update:modelValue`，model 层回写；重新打开靠场景控制区的按钮，Lab 在这里扮演宿主。
const subject = useLabSubject<typeof Dialog>(() => props.input, ["confirm", "cancel", "request-close"]);
</script>

<template>
    <Dialog v-bind="subject.bindings.value">
        <template v-if="subject.slots.value['header-extra']" #header-extra>
            <span class="shrink-0 text-xs text-[var(--text-muted)]">已保存 2 分钟前</span>
        </template>
        <template v-if="subject.slots.value.default" #default>
            <div class="space-y-3 text-sm">
                <p>把《长夜行》从书架移除后，作品目录与其中的文件都不会被删除，以后可以再加入书架。</p>
                <p class="text-[var(--text-muted)]">关闭、取消与确认都记在事件页签。</p>
            </div>
        </template>
    </Dialog>
    <LabFixtureControls>
        <Button size="sm" variant="secondary" @click="subject.write('model', 'modelValue', true)">打开对话框</Button>
    </LabFixtureControls>
</template>
