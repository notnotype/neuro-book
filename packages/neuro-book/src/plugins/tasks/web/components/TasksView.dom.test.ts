/**
 * TasksView 与 TasksHover（同名 .md；docs/specs/workbench/background-tasks.md 输出 10、11、13、16，验收 6）：仓库换成按
 * `TasksStore` 接口写的替身（清单是响应式的，方法记下调用；仓库本身的行为在 store.test.ts 经真实远程测），文字用宿主的翻译
 * 引擎，切换语言看原地换文字。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {computed, nextTick, ref, shallowRef} from "vue";

import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {TaskItem} from "../../shared/contracts";
import {tasksText} from "../../shared/text";
import type {TasksStore} from "../store";
import {tasksCatalogs} from "../text";

import TasksHover from "./TasksHover.vue";
import TasksView from "./TasksView.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const NOW = new Date().toISOString();

function task(id: string, extra: Partial<TaskItem> = {}): TaskItem {
    return {id, title: id, message: null, state: "running", progress: null, cancellable: false, cancelRequested: false, retryable: false, hasDetail: false, startedAt: NOW, endedAt: null, ...extra};
}

/** 按接口写的仓库替身：清单与“看过”可改，方法记下调用。 */
function fakeStore(initial: readonly TaskItem[]) {
    const items = shallowRef<readonly TaskItem[]>(initial);
    const calls: string[] = [];
    const visibility: boolean[] = [];
    const store: TasksStore = {
        items,
        running: computed(() => items.value.filter((item) => item.state === "running")),
        finished: computed(() => items.value.filter((item) => item.state !== "running")),
        unseenFailure: computed(() => false),
        setViewVisible: (visible) => void visibility.push(visible),
        cancel: async (id) => void calls.push(`cancel ${id}`),
        retry: async (id) => void calls.push(`retry ${id}`),
        remove: async (id) => void calls.push(`remove ${id}`),
        clearFinished: async () => void calls.push("clearFinished"),
        detail: async (id) => (id === "gone" ? null : {text: "bun install v1.4\nerror: ETIMEDOUT", truncated: true}),
        start: async () => undefined,
    };
    return {store, items, calls, visibility};
}

function engine() {
    const text = createHostTextEngine({locale: "zh-CN", strict: true});
    text.register("nbook.tasks", tasksCatalogs.catalogs, tasksCatalogs.source);
    return text;
}

function mountView(store: TasksStore, visible = ref(false)) {
    const text = engine();
    const wrapper = mount(TasksView, {attachTo: document.body, props: {store, context: {id: "nbook.tasks.list", generation: 1, visible, location: ref<"panel">("panel")}}, global: {provide: provideText(text.port)}});
    mounted.push(wrapper);
    return {wrapper, text};
}

describe("TasksView", () => {
    it("在跑的在上；进展一列按状态写；按钮按能做的事出现，正在取消的不可用；只有结束的能移除（输出 10）", async () => {
        const {store, calls} = fakeStore([
            task("t.running", {title: "初始化 Skill epub-export", message: "正在安装 23 个包", cancellable: true}),
            task("t.cancelling", {title: "导出 EPUB", progress: 40, cancellable: true, cancelRequested: true}),
            task("t.failed", {state: "failed", title: "初始化 Skill pdf-tools", message: "连不上 registry.npmjs.org（超时）", retryable: true, hasDetail: true, endedAt: NOW}),
            task("t.done", {state: "succeeded", endedAt: NOW}),
            task("t.cancelled", {state: "cancelled", endedAt: NOW}),
            task("t.interrupted", {state: "interrupted", message: "最后的进展", endedAt: NOW}),
        ]);
        const {wrapper} = mountView(store);
        const rows = wrapper.findAll("[data-task]");
        expect(rows.map((row) => row.attributes("data-task"))).toEqual(["t.running", "t.cancelling", "t.failed", "t.done", "t.cancelled", "t.interrupted"]);
        const status = (id: string): string => wrapper.get(`[data-task="${id}"] [data-task-status]`).text();
        expect(status("t.running")).toBe("正在安装 23 个包");
        expect(status("t.failed")).toBe("连不上 registry.npmjs.org（超时）");
        expect(status("t.done")).toBe("完成");
        expect(status("t.cancelled")).toBe("已取消");
        expect(status("t.interrupted")).toBe("已中断");
        expect(wrapper.find('[data-task="t.running"] [role="progressbar"]').exists()).toBe(true);
        expect(wrapper.find('[data-task="t.done"] [role="progressbar"]').exists()).toBe(false);

        const cancelling = wrapper.get('[data-task="t.cancelling"] [data-task-cancel]');
        expect(cancelling.text()).toBe("正在取消");
        expect(cancelling.attributes("disabled")).toBeDefined();
        expect(wrapper.find('[data-task="t.running"] [data-task-remove]').exists()).toBe(false);
        expect(wrapper.find('[data-task="t.interrupted"] [data-task-retry]').exists()).toBe(false);

        await wrapper.get('[data-task="t.running"] [data-task-cancel]').trigger("click");
        await wrapper.get('[data-task="t.failed"] [data-task-retry]').trigger("click");
        await wrapper.get('[data-task="t.done"] [data-task-remove]').trigger("click");
        expect(calls).toEqual(["cancel t.running", "retry t.failed", "remove t.done"]);
    });

    it("“详情”取原文，打开的对话框标题是“任务标题：详情”，被截断时注明（输出 11）", async () => {
        const {store} = fakeStore([task("t.failed", {state: "failed", title: "初始化 Skill pdf-tools", message: "超时", hasDetail: true, endedAt: NOW})]);
        const {wrapper} = mountView(store);
        await wrapper.get("[data-task-detail]").trigger("click");
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain("初始化 Skill pdf-tools：详情");
        }, {timeout: 5_000});
        expect(document.body.textContent).toContain("ETIMEDOUT");
        expect(document.body.textContent).toContain("原文过长，已截断");
    });

    it("空的时候居中一句说明；可见与否报给仓库，卸载时报不可见（输出 10、13）", async () => {
        const {store, visibility} = fakeStore([]);
        const visible = ref(false);
        const {wrapper} = mountView(store, visible);
        expect(wrapper.get(".tasks-view__empty").text()).toBe("没有后台任务。安装 Skill 这类要跑一阵的事会列在这里。");
        visible.value = true;
        await flushPromises();
        wrapper.unmount();
        expect(visibility).toEqual([false, true, false]);
    });

    it("标题与进展是文字引用时按界面语言翻，切换语言后原地换（验收 6）", async () => {
        const {store} = fakeStore([task("t.ref", {title: tasksText("views.list.title"), message: tasksText("list.running")})]);
        const {wrapper, text} = mountView(store);
        const row = wrapper.get('[data-task="t.ref"]');
        expect(row.text()).toContain("后台任务");
        text.setLocale("en-US");
        await nextTick();
        expect(row.text()).toContain("Background Tasks");
        expect(row.text()).toContain("Running");
    });
});

describe("TasksHover", () => {
    it("只列在跑的任务：标题与进度条一行，进展一行；切换语言后原地换", async () => {
        const {store} = fakeStore([
            task("t.a", {title: tasksText("views.list.title"), message: "正在安装 23 个包"}),
            task("t.b", {title: "导出 EPUB", progress: 40}),
            task("t.done", {state: "succeeded", endedAt: NOW}),
        ]);
        const text = engine();
        const wrapper = mount(TasksHover, {props: {store}, global: {provide: provideText(text.port)}});
        mounted.push(wrapper);
        const rows = wrapper.findAll(".tasks-hover__row");
        expect(rows).toHaveLength(2);
        expect(rows[0]!.text()).toContain("后台任务");
        expect(rows[0]!.text()).toContain("正在安装 23 个包");
        expect(rows[1]!.find('[role="progressbar"]').exists()).toBe(true);
        text.setLocale("en-US");
        await nextTick();
        expect(wrapper.findAll(".tasks-hover__row")[0]!.text()).toContain("Background Tasks");
    });
});
