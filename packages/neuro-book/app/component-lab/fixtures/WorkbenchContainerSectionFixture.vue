<script setup lang="ts">
/**
 * WorkbenchContainerSection 的 Lab 场景：五档结构（scroll / fill / 受控折叠 / 空态 / 不可折叠）。
 *
 * 夹具在这里扮**宿主**：区段是卡片内的平铺分区，宽度、留白与纵向滚动都归宿主
 * （真实宿主是 `WorkbenchContainerSurface` 的 `--sections` 区，它自带 `overflow-y: auto`）。
 * 少了这一层，`scroll` 档的区段没有高度上限，它自己那条 `overflow-y` 永远不会滚；
 * `fill` 档也吸不到剩余高度（`flex: 1 1 0px` 在没有高度的父级里不成立）。
 *
 * 折叠走**受控**路径：夹具持 `collapsed`，不把状态让给组件的内部 state。
 * 组件对同一次点击同时发 `update:collapsed` 与 `toggle`，两条接到同一个处理函数，
 * 只有真改变本地态的那一次记账——否则一次点击会在事件面板里留两条记录。
 *
 * `data` 是登记初值：`title` / `contextLabel` / `rows` / `emptyText` 直接算进绑定，右栏改字立刻可见；
 * `collapsed` 也在 data 变时按 data 重取，右栏按「还原」后场景必须回到登记态。
 */
import {computed} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";
import WorkbenchContainerSection from "nbook/app/components/workbench/WorkbenchContainerSection.vue";
import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof WorkbenchContainerSection>(() => props.input);

const emitLabEvent = useLabEventSink();

/** 中性演示行：只用来量几何与滚动归属，不承载业务含义。 */
const rows = computed(() => Array.from({length: props.scene === "collapsed" ? 7 : props.scene === "no-collapse" ? 4 : props.scene === "empty-text" ? 0 : 40}, (_, index) => index + 1));

function onCollapsedChange(value: boolean): void {
    if (subject.bindings.value.collapsed === value) return;
    subject.write("model", "collapsed", value);
    emitLabEvent("toggle", value);
}

/** 动作槽里的按钮。不补 `stopPropagation`：折叠与否由组件头部那层 `@click.stop` 保证。 */
function onAction(name: string): void {
    emitLabEvent("action", name);
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col bg-[var(--panel-surface)]">
        <!--
            宿主的区段列表区：区段自己不写宽度、不写外边距，纵向滚动也归这里
            （口径同 WorkbenchContainerSurface 的 `--sections`：`overflow-y: auto`）。
        -->
        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <WorkbenchContainerSection
                data-lab-subject
                v-bind="subject.bindings.value"
                @update:collapsed="onCollapsedChange"
                @toggle="onCollapsedChange"
            >
                <!-- 空态那档整块插槽都不给：组件的空态判定正是「没有内容槽 + 有 emptyText」。 -->
                <template v-if="subject.slots.value.default" #default>
                    <!--
                        fill 档：区段只裁切（body--fill 没有 padding 且 overflow: hidden），
                        留白与滚动都归内容——这里内容自己给一条滚动区，再加一行自己的头部。
                    -->
                    <div v-if="subject.bindings.value.layout === 'fill'" class="flex min-h-0 flex-1 flex-col">
                        <p class="flex shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--divider)] px-[var(--space-2)] py-[var(--space-2)] text-[var(--text-2xs)] text-[var(--text-muted)]">
                            内容自己的头部与留白 <span class="ml-auto">{{ rows.length }} 条</span>
                        </p>
                        <ul class="flex min-h-0 flex-1 flex-col gap-[var(--space-1)] overflow-y-auto p-[var(--space-2)]">
                            <li
                                v-for="row in rows"
                                :key="row"
                                class="flex min-w-0 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                            >
                                <span class="i-lucide-message-square h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                                <span class="min-w-0 truncate">示例条目 {{ row }}</span>
                            </li>
                        </ul>
                    </div>

                    <!--
                        scroll 档：留白与滚动归区段自己（body--scroll 已带 padding 与 overflow-y），
                        内容只摆条目，不自带内边距。
                    -->
                    <ul v-else class="flex min-w-0 flex-col gap-[var(--space-1)]">
                        <li
                            v-for="row in rows"
                            :key="row"
                            class="flex min-w-0 items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--text-xs)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        >
                            <span class="i-lucide-file-text h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                            <span class="min-w-0 truncate">示例条目 {{ row }}</span>
                        </li>
                    </ul>
                </template>

                <!--
                    动作槽：点它**不该**折叠。组件在槽外层写了 `@click.stop`，夹具因此不加任何拦截——
                    组件哪天丢了那个 stop，这里点一下就会在事件面板里多出一条 toggle。
                -->
                <template v-if="subject.slots.value.actions" #actions>
                    <IconButton size="sm" icon-class="i-lucide-refresh-cw" title="刷新（宿主动作）" @click="onAction('refresh')" />
                </template>

                <!-- fill 档的上下文走插槽：显示当前渲染出来的行数，右栏改 rows 这里跟着变。 -->
                <template v-if="subject.slots.value.context" #context>
                    <span class="tabular-nums">{{ rows.length }} 条</span>
                </template>
            </WorkbenchContainerSection>
        </div>
    </div>
</template>
