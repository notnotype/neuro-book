<script setup lang="ts">
import {computed, onBeforeUnmount, ref} from "vue";
import {Button, DataTable, IconButton, Input, SegmentedControl} from "@notnotype/nb-ui/components";

import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import {SAMPLE_LAST_PAGE, SAMPLE_TOTAL, samplePage} from "./data-table-sample";
import type {SampleDataTable} from "./data-table-sample";

const props = defineProps<LabFixtureProps>();
// 页脚的条数是定高一行里的文字，英文常比中文长：场景 id 以 `-english` 结尾的注入英文端口，看截断与窄宽时的写法。
if (props.scene.endsWith("-english")) provideHostText(createHostTextEngine({locale: "en-US"}).port);
// 夹具扮演使用方：受控的页码、行、总数、加载与出错都写回场景输入，翻页时模拟一次取数。
const subject = useLabSubject<SampleDataTable>(() => props.input, ["retry", "row-click"]);

/** 模拟取数的耗时，比组件的加载延时长，翻页时看得到遮罩淡入。 */
const FETCH_DELAY = 900;
let fetchTimer: ReturnType<typeof setTimeout> | undefined;
/** 每次取数领一个号，后到的旧请求丢掉：DataTable 不管请求的先后，使用方要管（DataTable.md 的“状态”）。 */
let fetchSeq = 0;

function cancelFetch(): void {
    if (fetchTimer !== undefined) clearTimeout(fetchTimer);
    fetchTimer = undefined;
}

function fetchPage(page: number, options: {keepRows: boolean}): void {
    cancelFetch();
    const seq = ++fetchSeq;
    subject.write("props", "error", undefined);
    if (!options.keepRows) {
        subject.write("props", "rows", []);
        subject.write("props", "total", null);
    }
    subject.write("props", "loading", true);
    fetchTimer = setTimeout(() => {
        if (seq !== fetchSeq) return;
        fetchTimer = undefined;
        subject.write("props", "rows", samplePage(page));
        subject.write("props", "total", SAMPLE_TOTAL);
        subject.write("props", "loading", false);
    }, FETCH_DELAY);
}

const currentPage = computed(() => Number(props.input?.model?.page ?? 1));

const bindings = computed(() => ({
    ...subject.bindings.value,
    "onUpdate:page": (page: number) => {
        subject.bindings.value["onUpdate:page"]?.(page);
        fetchPage(page, {keepRows: true});
    },
    onRetry: () => {
        subject.bindings.value.onRetry?.();
        fetchPage(currentPage.value, {keepRows: true});
    },
}));

function goTo(page: number): void {
    cancelFetch();
    subject.write("model", "page", page);
    subject.write("props", "rows", samplePage(page));
    subject.write("props", "total", SAMPLE_TOTAL);
    subject.write("props", "loading", false);
    subject.write("props", "error", undefined);
}

function showEmpty(): void {
    cancelFetch();
    subject.write("model", "page", 1);
    subject.write("props", "rows", []);
    subject.write("props", "total", 0);
    subject.write("props", "loading", false);
    subject.write("props", "error", undefined);
}

function showError(): void {
    cancelFetch();
    subject.write("props", "loading", false);
    subject.write("props", "error", "章节列表没有取回来，请稍后重试");
}

function firstLoad(): void {
    subject.write("model", "page", 1);
    fetchPage(1, {keepRows: false});
}

function pageLoad(): void {
    const next = currentPage.value >= SAMPLE_LAST_PAGE ? 1 : currentPage.value + 1;
    subject.write("model", "page", next);
    fetchPage(next, {keepRows: true});
}

onBeforeUnmount(cancelFetch);

// 工具条里的筛选与搜索只是样子，不参与取数：DataTable 不管筛选，场景只看三块的版式。
const filter = ref("all");
const FILTERS = [{label: "全部", value: "all"}, {label: "草稿", value: "draft"}, {label: "已定稿", value: "final"}];
const query = ref("");
</script>

<template>
    <div class="lab-data-table-frame">
        <DataTable v-bind="bindings" data-lab-subject>
            <template #filters>
                <SegmentedControl v-model="filter" size="sm" :options="FILTERS" />
            </template>
            <template #actions>
                <Input v-model="query" size="sm" placeholder="搜索章节" class="lab-data-table-search" />
            </template>
            <template #cell-id>
                <IconButton size="xs" icon-class="i-lucide-ellipsis" title="更多操作" />
            </template>
        </DataTable>
    </div>
    <LabFixtureControls>
        <Button size="sm" variant="secondary" @click="goTo(1)">第一页</Button>
        <Button size="sm" variant="secondary" @click="goTo(SAMPLE_LAST_PAGE)">最后一页</Button>
        <Button size="sm" variant="secondary" @click="firstLoad">首次加载</Button>
        <Button size="sm" variant="secondary" @click="pageLoad">翻页加载</Button>
        <Button size="sm" variant="secondary" @click="showEmpty">空</Button>
        <Button size="sm" variant="secondary" @click="showError">出错</Button>
    </LabFixtureControls>
</template>

<style scoped>
/* DataTable 要放进有确定高度的容器（DataTable.md 的“布局”）；定宽定高都写成 min(…, 100%)，窄画布里不溢出。 */
.lab-data-table-frame {
    width: min(960px, 100%);
    height: min(640px, 100%);
}

.lab-data-table-search {
    width: min(200px, 100%);
}
</style>
