/**
 * TasksView 与 TasksHover（同名 .md；docs/specs/workbench/background-tasks.md 输出 10、11、13、16、24–28，验收 6）：两份仓库换成按
 * `TasksStore`、`RowsStore` 接口写的替身（数据是响应式的，方法记下调用；仓库本身的行为在 store.test.ts 经真实远程测），文字用宿主的
 * 翻译引擎，切换语言看原地换文字。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {computed, nextTick, ref, shallowRef} from "vue";

import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {BackgroundSummary, ListedRow, RowGroup, RowsPayload, TaskItem} from "../../shared/contracts";
import {tasksText} from "../../shared/text";
import {groupKey} from "../rows";
import type {RowsStore} from "../rows";
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
    return {id, title: id, message: null, state: "running", progress: null, cancellable: false, cancelRequested: false, retryable: false, hasDetail: false, startedAt: NOW, endedAt: null, owner: {kind: "app"}, ...extra};
}

const ownRow = (item: TaskItem): ListedRow => ({key: `own:${item.id}`, source: {kind: "own", id: item.id}, kind: "nbook.tasks.task", kindLabel: null, title: item.title, message: item.message, state: item.state, progress: item.progress, startedAt: item.startedAt, endedAt: item.endedAt, foreground: false, stoppable: false, open: null, own: item});

function providerRow(id: string, extra: Partial<ListedRow> = {}): ListedRow {
    return {key: `p:nbook.agent:1:${id}`, source: {kind: "provider", plugin: "nbook.agent"}, kind: "nbook.agent.shell", kindLabel: "命令", title: id, message: null, state: "running", progress: null, startedAt: NOW, endedAt: null, foreground: false, stoppable: true, open: null, own: null, ...extra};
}

const app = (items: readonly TaskItem[]): RowGroup => ({kind: "app", rows: items.map(ownRow)});

/** 按接口写的自己的任务的仓库替身：清单与“看过”可改，方法记下调用。 */
function fakeStore(initial: readonly TaskItem[], summary: BackgroundSummary = {count: 0, items: []}) {
    const items = shallowRef<readonly TaskItem[]>(initial);
    const background = shallowRef<BackgroundSummary>(summary);
    const calls: string[] = [];
    const visibility: boolean[] = [];
    const shown: string[][] = [];
    const unseen = shallowRef(false);
    const store: TasksStore = {
        items,
        background,
        running: computed(() => items.value.filter((item) => item.state === "running")),
        finished: computed(() => items.value.filter((item) => item.state !== "running")),
        unseenFailure: computed(() => unseen.value),
        setViewVisible: (visible) => void visibility.push(visible),
        setShown: (ids) => void shown.push([...ids].sort()),
        cancel: async (id) => void calls.push(`cancel ${id}`),
        retry: async (id) => void calls.push(`retry ${id}`),
        remove: async (id) => void calls.push(`remove ${id}`),
        clearFinished: async () => void calls.push("clearFinished"),
        detail: async (id) => (id === "gone" ? null : {text: "bun install v1.4\nerror: ETIMEDOUT", truncated: true}),
        start: async () => undefined,
    };
    return {store, items, background, calls, visibility, shown, unseen};
}

/** 按接口写的分组行的仓库替身：收起真的切换，别的方法记下调用。 */
function fakeRows(groups: readonly RowGroup[], extra: {more?: number; elsewhere?: number; all?: boolean; stopping?: readonly string[]} = {}) {
    const calls: string[] = [];
    const visibility: boolean[] = [];
    const collapsed = shallowRef<ReadonlySet<string>>(new Set());
    const payload = shallowRef<RowsPayload | null>({version: 1, groups: [...groups], more: extra.more ?? 0, elsewhere: extra.elsewhere ?? 0});
    const rows: RowsStore = {
        payload,
        all: shallowRef(extra.all ?? false),
        collapsed,
        stopping: shallowRef(new Set(extra.stopping ?? [])),
        hasProject: computed(() => true),
        setVisible: (visible) => void visibility.push(visible),
        setAll: (all) => void calls.push(`all ${String(all)}`),
        toggleGroup(key) {
            const next = new Set(collapsed.value);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            collapsed.value = next;
        },
        stop: async (key) => void calls.push(`stop ${key}`),
        open: async (target, plugin) => void calls.push(`open ${target.command} ${plugin}`),
        start: () => undefined,
    };
    return {rows, calls, visibility, payload};
}

function engine() {
    const text = createHostTextEngine({locale: "zh-CN", strict: true});
    text.register("nbook.tasks", tasksCatalogs.catalogs, tasksCatalogs.source);
    return text;
}

function mountView(store: TasksStore, rows: RowsStore, visible = ref(false)) {
    const text = engine();
    const wrapper = mount(TasksView, {attachTo: document.body, props: {store, rows, context: {id: "nbook.tasks.list", generation: 1, visible, location: ref<"panel">("panel")}}, global: {provide: provideText(text.port)}});
    mounted.push(wrapper);
    return {wrapper, text};
}

describe("TasksView", () => {
    it("自己的任务：进展一列按状态写；按钮按能做的事出现，正在取消的不可用；只有结束的能移除（输出 10）", async () => {
        const items = [
            task("t.running", {title: "初始化 Skill epub-export", message: "正在安装 23 个包", cancellable: true}),
            task("t.cancelling", {title: "导出 EPUB", progress: 40, cancellable: true, cancelRequested: true}),
            task("t.failed", {state: "failed", title: "初始化 Skill pdf-tools", message: "连不上 registry.npmjs.org（超时）", retryable: true, hasDetail: true, endedAt: NOW}),
            task("t.done", {state: "succeeded", endedAt: NOW}),
            task("t.cancelled", {state: "cancelled", endedAt: NOW}),
            task("t.interrupted", {state: "interrupted", message: "最后的进展", endedAt: NOW}),
        ];
        const {store, calls} = fakeStore(items);
        const {wrapper} = mountView(store, fakeRows([app(items)]).rows);
        expect(wrapper.findAll("[data-row]").map((row) => row.attributes("data-row"))).toEqual(items.map((item) => `own:${item.id}`));
        const status = (id: string): string => wrapper.get(`[data-row="own:${id}"] [data-task-status]`).text();
        expect(status("t.running")).toBe("正在安装 23 个包");
        expect(status("t.failed")).toBe("连不上 registry.npmjs.org（超时）");
        expect(status("t.done")).toBe("完成");
        expect(status("t.cancelled")).toBe("已取消");
        expect(status("t.interrupted")).toBe("已中断");
        expect(wrapper.find('[data-row="own:t.running"] [role="progressbar"]').exists()).toBe(true);
        expect(wrapper.find('[data-row="own:t.done"] [role="progressbar"]').exists()).toBe(false);
        const cancelling = wrapper.get('[data-row="own:t.cancelling"] [data-task-cancel]');
        expect(cancelling.text()).toBe("正在取消");
        expect(cancelling.attributes("disabled")).toBeDefined();
        expect(wrapper.find('[data-row="own:t.running"] [data-task-remove]').exists()).toBe(false);
        await wrapper.get('[data-row="own:t.running"] [data-task-cancel]').trigger("click");
        await wrapper.get('[data-row="own:t.failed"] [data-task-retry]').trigger("click");
        await wrapper.get('[data-row="own:t.done"] [data-task-remove]').trigger("click");
        expect(calls).toEqual(["cancel t.running", "retry t.failed", "remove t.done"]);
    });

    it("“详情”取原文，打开的对话框标题是“任务标题：详情”，被截断时注明（输出 11）", async () => {
        const items = [task("t.failed", {state: "failed", title: "初始化 Skill pdf-tools", message: "超时", hasDetail: true, endedAt: NOW})];
        const {store} = fakeStore(items);
        const {wrapper} = mountView(store, fakeRows([app(items)]).rows);
        await wrapper.get("[data-task-detail]").trigger("click");
        await vi.waitFor(() => {
            expect(document.body.textContent).toContain("初始化 Skill pdf-tools：详情");
        }, {timeout: 5_000});
        expect(document.body.textContent).toContain("ETIMEDOUT");
        expect(document.body.textContent).toContain("原文过长，已截断");
    });

    it("空的时候居中一句说明；可见与否报给两份仓库，卸载时报不可见（输出 10、13）", async () => {
        const {store, visibility} = fakeStore([]);
        const fake = fakeRows([]);
        const visible = ref(false);
        const {wrapper} = mountView(store, fake.rows, visible);
        expect(wrapper.get(".tasks-view__empty").text()).toBe("没有后台任务。安装 Skill 这类要跑一阵的事会列在这里。");
        visible.value = true;
        await flushPromises();
        wrapper.unmount();
        expect(visibility).toEqual([false, true, false]);
        expect(fake.visibility).toEqual([false, true, false]);
    });

    it("标题与进展是文字引用时按界面语言翻，切换语言后原地换（验收 6）", async () => {
        const items = [task("t.ref", {title: tasksText("views.list.title"), message: tasksText("list.running")})];
        const {store} = fakeStore(items);
        const {wrapper, text} = mountView(store, fakeRows([app(items)]).rows);
        const row = wrapper.get('[data-row="own:t.ref"]');
        expect(row.text()).toContain("后台任务");
        text.setLocale("en-US");
        await nextTick();
        expect(row.text()).toContain("Background Tasks");
        expect(row.text()).toContain("Running");
    });

    it("会话块：组头是会话自己，等你处理时有徽标；提供方的行写种类、可停可打开、没有移除；正在停止的不可用（输出 24–26）", async () => {
        const open = {command: "nbook.agent.focus-session", args: {sessionId: "s1"}};
        const head = providerRow("head", {kind: "nbook.agent.session", kindLabel: "会话", title: "第十二章修订", message: "等你批准", state: "waiting", foreground: true, open});
        const group: RowGroup = {kind: "session", session: "s1", title: "第十二章修订", open, waiting: true, head, rows: [providerRow("bun run build"), providerRow("校对", {kind: "nbook.agent.agent", kindLabel: "子代理", open: {command: "nbook.agent.focus-session", args: {sessionId: "c1"}}})]};
        const fake = fakeRows([group], {stopping: ["p:nbook.agent:1:bun run build"]});
        const {wrapper} = mountView(fakeStore([]).store, fake.rows);
        const block = wrapper.get('[data-group="session:s1"]');
        expect(block.attributes("data-waiting")).toBeDefined();
        expect(block.get(".tasks-group__head").text()).toContain("第十二章修订");
        expect(block.get(".tasks-group__head").text()).toContain("等你处理");
        expect(block.get("[data-group-status]").text()).toBe("等你批准");
        expect(wrapper.get('[data-row="p:nbook.agent:1:校对"]').text()).toContain("子代理");
        expect(wrapper.find('[data-row="p:nbook.agent:1:校对"] [data-task-remove]').exists()).toBe(false);
        const stopping = wrapper.get('[data-row="p:nbook.agent:1:bun run build"] [data-row-stop]');
        expect(stopping.text()).toBe("正在停止");
        expect(stopping.attributes("disabled")).toBeDefined();
        await block.get("[data-group-stop]").trigger("click");
        await block.get("[data-group-open]").trigger("click");
        await wrapper.get('[data-row="p:nbook.agent:1:校对"] [data-row-open]').trigger("click");
        expect(fake.calls).toEqual(["stop p:nbook.agent:1:head", "open nbook.agent.focus-session nbook.agent", "open nbook.agent.focus-session nbook.agent"]);
    });

    it("收起箭头切换这一组、可访问名称与展开状态跟着；收起的组里自己的已结束任务不算看过（输出 26、28）", async () => {
        const items = [task("t.done", {state: "succeeded", endedAt: NOW}), task("t.run")];
        const own = fakeStore(items);
        const fake = fakeRows([app(items)]);
        const {wrapper} = mountView(own.store, fake.rows);
        expect(own.shown.at(-1)).toEqual(["t.done"]);
        const toggle = wrapper.get(`[data-group="${groupKey(app(items))}"] [data-group-toggle]`);
        expect(toggle.attributes("aria-expanded")).toBe("true");
        expect(toggle.attributes("aria-label")).toBe("收起 应用");
        await toggle.trigger("click");
        expect(toggle.attributes("aria-expanded")).toBe("false");
        expect(toggle.attributes("aria-label")).toBe("展开 应用");
        expect(own.shown.at(-1)).toEqual([]);
    });

    it("列表末尾写没列出的件数与其他项目在运行的件数；取全部项目时不写后者（输出 26）", async () => {
        const items = [task("t.a")];
        const narrow = mountView(fakeStore(items).store, fakeRows([app(items)], {more: 12, elsewhere: 3}).rows);
        expect(narrow.wrapper.get("[data-rows-more]").text()).toBe("另有 12 件没有列出");
        expect(narrow.wrapper.get("[data-rows-elsewhere]").text()).toBe("其他项目还有 3 件在运行");
        const all = mountView(fakeStore(items).store, fakeRows([app(items)], {elsewhere: 3, all: true}).rows);
        expect(all.wrapper.find("[data-rows-elsewhere]").exists()).toBe(false);
    });

    it("项目组：当前项目在前，其余按翻译后的名字排（输出 26）", () => {
        const project = (id: string, title: string, current: boolean): RowGroup => ({kind: "project", project: id, title, current, rows: [ownRow(task(`t.${id}`, {owner: {kind: "project", project: id, title}}))]});
        const {wrapper} = mountView(fakeStore([]).store, fakeRows([project("p-z", "长夜", true), project("p-b", "雾港", false), project("p-a", "白昼", false)]).rows);
        expect(wrapper.findAll("[data-group]").map((group) => group.attributes("data-group"))).toEqual(["project:p-z", "project:p-a", "project:p-b"]);
    });
});

describe("TasksHover", () => {
    it("列出后台工作：标题与进度条一行，进展一行；超过列出的件数时末尾写还有几件；切换语言后原地换", async () => {
        const {store} = fakeStore([], {count: 5, items: [{title: tasksText("views.list.title"), message: "正在安装 23 个包", progress: null}, {title: "导出 EPUB", message: null, progress: 40}]});
        const text = engine();
        const wrapper = mount(TasksHover, {props: {store}, global: {provide: provideText(text.port)}});
        mounted.push(wrapper);
        const rows = wrapper.findAll(".tasks-hover__row");
        expect(rows).toHaveLength(2);
        expect(rows[0]!.text()).toContain("后台任务");
        expect(rows[0]!.text()).toContain("正在安装 23 个包");
        expect(rows[1]!.find('[role="progressbar"]').exists()).toBe(true);
        expect(wrapper.get("[data-tasks-hover-more]").text()).toBe("还有 3 件");
        text.setLocale("en-US");
        await nextTick();
        expect(wrapper.findAll(".tasks-hover__row")[0]!.text()).toContain("Background Tasks");
    });

    it("没有在跑的：不是空框，写条目的一句说明，有没看过的失败时换一句", async () => {
        const {store, unseen} = fakeStore([task("t.done", {state: "failed", endedAt: NOW})]);
        const text = engine();
        const wrapper = mount(TasksHover, {props: {store}, global: {provide: provideText(text.port)}});
        mounted.push(wrapper);
        expect(wrapper.text()).toBe("后台任务：都结束了");
        unseen.value = true;
        await nextTick();
        expect(wrapper.text()).toBe("后台任务：有没看过的失败");
    });
});
