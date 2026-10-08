<script setup lang="ts">
/**
 * WorkbenchViewContainerHost 的夹具：自己当一层小小的视图实例宿主——按 `target` 事件把样例内容搬进分节里的落点，
 * 收起开关与边界手势写回场景输入，场景里因此能真实地拖动边界、收起与展开。
 */
import {reactive} from "vue";

import WorkbenchViewContainerHost from "nbook/plugins/workbench/web/components/WorkbenchViewContainerHost.vue";
import type {ContainerPresentation} from "nbook/plugins/workbench/web/views/presentation";

import {useLabSubject} from "../lab-subject";
import type {LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof WorkbenchViewContainerHost>(() => props.input, ["resize", "toggle-collapsed", "target"]);
const targets = reactive(new Map<string, HTMLElement>());

function onTarget(viewId: string, element: HTMLElement | null): void {
    if (element === null) targets.delete(viewId);
    else targets.set(viewId, element);
}

function container(): ContainerPresentation {
    return subject.bindings.value.container as ContainerPresentation;
}

function onToggle(viewId: string, collapsed: boolean): void {
    const current = container();
    subject.write("props", "container", {...current, views: current.views.map((view) => (view.id === viewId ? {...view, collapsed} : view))});
}

function onResize(payload: {sizes: Record<string, number>}): void {
    const current = container();
    subject.write("props", "container", {...current, views: current.views.map((view) => (payload.sizes[view.id] === undefined ? view : {...view, size: payload.sizes[view.id]}))});
}
</script>

<template>
    <div class="h-full w-full bg-[var(--panel-surface)]">
        <WorkbenchViewContainerHost data-lab-subject v-bind="subject.bindings.value" @target="onTarget" @toggle-collapsed="onToggle" @resize="onResize" />
        <div class="hidden" aria-hidden="true" inert>
            <Teleport v-for="view in container().views" :key="view.id" :to="targets.get(view.id) ?? undefined" :disabled="targets.get(view.id) === undefined">
                <ul class="text-sm" :data-sample-view="view.id">
                    <li v-for="row in 30" :key="row" class="rounded px-2 py-1 hover:bg-[var(--bg-hover)]">{{ view.title["zh-CN"] }} · 条目 {{ row }}</li>
                </ul>
            </Teleport>
        </div>
    </div>
</template>
