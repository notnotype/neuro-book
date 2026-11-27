<script setup lang="ts">
/**
 * 窗口里那一个还原对话框（docs/specs/canon/author-ui.md 输出 22）：canon 交给工作台的页面浮层挂着它。要还原哪一次由窗口里的
 * `RevertRequests` 给（回执页、保存后的提示、改动记录都往那里放），预览、写入与提示在 `revert.ts`；这里只把带来的变化里的
 * 地址写成“星瑕的存款”（读条目名字与字段显示名），交给 `RevertDialog` 画。
 */
import {computed, shallowRef, watch} from "vue";

import {useText} from "@notnotype/nb-ui/text-port";

import type {CanonClient} from "../../../shared/contracts";
import {useEntryHeads} from "../../entry-heads";
import {impactLines} from "../../impact";
import type {CanonNotices} from "../../notices";
import {defaultPosition} from "../../positions";
import {useRevert} from "../../revert";
import type {RevertModel, RevertRequests} from "../../revert";
import {useCanonText} from "../../text";
import {useWorldRead} from "../../use-reads";
import type {CanonWorld} from "../../world";
import RevertDialog from "./RevertDialog.vue";

const props = defineProps<{
    world: CanonWorld;
    /** 世界客户端的读取（预览、读修订）。包在对象里传，理由同 `EntryPageHost`。 */
    client: Pick<CanonClient, "call">;
    requests: RevertRequests;
    notices: CanonNotices;
}>();

const text = useCanonText();
const port = useText();
const revert = useRevert({
    world: props.world,
    call: props.client.call,
    requests: props.requests,
    notices: props.notices,
    revertTitle: (original, dependents) => (dependents > 0 ? text("revert.savedWithDependents", {title: original, count: dependents}) : text("revert.saved", {title: original})),
});
const model = computed(() => revert.model.value);
// 关掉以后对话框还有一段收起的动画：这期间接着显示最后的内容，不清成“正在预览…”；动画结束（`closed`）再清掉，名字的读取
// 随之释放。
const last = shallowRef<RevertModel | null>(null);
watch(model, (now) => {
    if (now !== null) last.value = now;
}, {immediate: true});
const shown = computed(() => model.value ?? last.value);

// 只在对话框开着、有带来的变化要写时才读名字。
const shownImpact = computed(() => shown.value?.impact ?? null);
const chaptersRead = useWorldRead(props.world, "chapters", () => (shownImpact.value === null ? null : {}));
const ids = computed(() => [...new Set(shownImpact.value?.values.map((value) => value.at.entry) ?? [])]);
const heads = useEntryHeads(props.world, () => ids.value, () => (chaptersRead.value?.data === undefined ? null : defaultPosition(chaptersRead.value.data.items)), text);
const impact = computed(() => (shownImpact.value === null ? [] : impactLines(shownImpact.value, {values: "change", address: heads.address}, text)));
const resolved = (value: Parameters<typeof port.t>[0] | null | undefined): string => (value === null || value === undefined ? "" : port.t(value));
</script>

<template>
    <RevertDialog
        :open="model !== null"
        :title="shown?.title ?? ''"
        :phase="shown?.phase ?? 'previewing'"
        :impact="impact"
        :dependents="shown?.dependents ?? []"
        :more-dependents="shown?.moreDependents ?? 0"
        :reason="resolved(shown?.reason)"
        :error="resolved(shown?.error)"
        :recheck="shown?.recheck ?? false"
        :saving="shown?.saving ?? false"
        @update:open="(value: boolean) => !value && revert.close()"
        @confirm="revert.confirm()"
        @recheck="revert.confirm()"
        @closed="model === null && (last = null)"
    />
</template>
