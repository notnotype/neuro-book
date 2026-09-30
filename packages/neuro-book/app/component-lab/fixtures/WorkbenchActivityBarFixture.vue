<script setup lang="ts">
/**
 * WorkbenchActivityBar 的 Lab 场景（纯 props，无产品依赖）。
 *
 * 演示重点：
 * 1. 三组几何：主入口在上、次要入口居中、底部入口贴底；每项 40px、步距 44px；
 * 2. overflow：矮容器里次要入口从尾部进 More 菜单，菜单里保留 active 与禁用理由；
 * 3. disabled：禁用项不执行，理由进 tooltip 与 aria-label；
 * 4. short：极短高度下主入口组与底部组各自滚动，More 不会被盖住；
 * 5. active：当前入口的底色、文字色与左侧标记条。
 */
import {ref, watch} from "vue";
import WorkbenchActivityBar from "nbook/app/components/workbench/WorkbenchActivityBar.vue";
import {useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof WorkbenchActivityBar>(() => props.input);

const emitLabEvent = useLabEventSink();


const lastInvoked = ref("");


function onInvoke(id: string): void {
    lastInvoked.value = id;
    emitLabEvent("activity-invoke", {id});
}

watch(() => props.scene, () => {
    lastInvoked.value = "";
});
</script>

<template>
    <div class="flex h-full w-full">
        <LabFixtureControls>
            <div class="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                <div class="font-medium text-[var(--text-main)]">活动栏（通用件 · 纯 props）</div>
                <div>主入口 {{ subject.bindings.value.primary?.length ?? 0 }} 项 · 次要入口 {{ subject.bindings.value.secondary?.length ?? 0 }} 项 · 底部入口 {{ subject.bindings.value.footer?.length ?? 0 }} 项</div>
                <div>最近触发：<span class="font-mono text-[var(--text-main)]">{{ lastInvoked === "" ? "（还没点）" : lastInvoked }}</span></div>
            </div>
        </LabFixtureControls>

        <!-- 活动栏贴左充满视口高度 -->
        <div class="h-full w-[48px] shrink-0 border-r border-[var(--divider)] bg-[var(--bg-main)]">
            <WorkbenchActivityBar
                data-lab-subject="activity-bar"
                class="h-full w-full"
                v-bind="subject.bindings.value"
                @invoke="onInvoke"
            />
        </div>

        <!-- 模拟工作区其余部分 -->
        <div class="flex flex-1 items-center justify-center bg-[var(--panel-surface)] text-xs text-[var(--text-muted)] select-none">
            <span>工作台内容区域（可通过拖拽画布下沿调整高度观察滚动表现）</span>
        </div>
    </div>
</template>
