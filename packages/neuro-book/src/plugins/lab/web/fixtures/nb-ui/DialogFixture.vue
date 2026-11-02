<script setup lang="ts">
import {Button, Dialog, Select} from "@notnotype/nb-ui/components";
import {ref} from "vue";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();
// 关闭由组件自己发 `update:open`，model 层回写；重新打开靠场景控制区的按钮，Lab 在这里扮演宿主。
const subject = useLabSubject<typeof Dialog>(() => props.input, ["confirm", "request-close", "closed"]);
const genre = ref("novel");
const GENRES = [{label: "长篇小说", value: "novel"}, {label: "短篇集", value: "stories"}, {label: "剧本", value: "script"}];
/** “叠一层”场景：从这个对话框里再打开一个，看后开的是否压在上面。 */
const stackedOpen = ref(false);
// 下拉与“再开一层”按场景给，不当成组件的插槽（它们是夹具自己加的内容）。
const withSelect = (): boolean => props.scene === "with-select";
const withStack = (): boolean => props.scene === "stacked";
/** 没有标题栏的窗口：正文自己画标题行、标成拖动区域，右端给角上的关闭按钮让位（Dialog.md 的“布局”）。 */
const headerless = (): boolean => props.scene === "window-headerless";
</script>

<template>
    <Dialog v-bind="subject.bindings.value">
        <template v-if="subject.slots.value['header-extra']" #header-extra>
            <span class="shrink-0 text-xs text-[var(--text-muted)]">已保存 2 分钟前</span>
        </template>
        <template v-if="subject.slots.value.default" #default>
            <div class="space-y-3 text-sm">
                <div v-if="headerless()" class="flex items-center gap-2 font-semibold" :style="{paddingRight: 'calc(var(--nb-dialog-close-room) - var(--panel-p))'}" data-dialog-drag>
                    <span class="i-lucide-images"></span>
                    <span>素材</span>
                </div>
                <p>把《长夜行》从书架移除后，作品目录与其中的文件都不会被删除，以后可以再加入书架。</p>
                <p class="text-[var(--text-muted)]">关闭、取消与确认都记在事件页签。</p>
                <Select v-if="withSelect()" v-model="genre" :options="GENRES" data-lab-dialog-select />
                <Button v-if="withStack()" size="sm" variant="secondary" data-lab-dialog-stack @click="stackedOpen = true">再开一层…</Button>
            </div>
        </template>
        <template v-if="subject.slots.value.footer" #footer>
            <Button variant="secondary" @click="subject.write('model', 'open', false)">取消</Button>
            <Button @click="subject.write('model', 'open', false)">创建</Button>
        </template>
    </Dialog>
    <Dialog v-model:open="stackedOpen" size="sm" title="第二层" :show-cancel="true" data-lab-dialog-second>
        <p class="text-sm">后打开的对话框压在先打开的上面；Esc 与点遮罩只关这一层。</p>
    </Dialog>
    <LabFixtureControls>
        <Button size="sm" variant="secondary" @click="subject.write('model', 'open', true)">打开对话框</Button>
    </LabFixtureControls>
</template>
