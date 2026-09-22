// @vitest-environment jsdom
import {describe, expect, it, vi} from "vitest";
import {effectScope, nextTick, ref, type Ref} from "vue";
import {createCommandRegistry, type CommandRegistry} from "nbook/app/utils/workbench/commands";
import {SHELL_FILES_VIEW} from "nbook/app/utils/workbench/product-catalog";
import type {WorkbenchViewEntry} from "nbook/app/utils/workbench/product-catalog";
import {SHELL_VIEW_COMMAND_IDS, SHELL_FILES_REFRESH_COMMAND} from "nbook/app/utils/workbench/workbench-shell-commands";
import {useWorkbenchViewActions, type WorkbenchViewActionsConsumer} from "nbook/app/composables/useWorkbenchViewActions";
import type {ViewActionTarget, WorkbenchViewActionHandle} from "nbook/app/utils/workbench/view-title-actions";

/**
 * View 标题动作的宿主会话：句柄 / 状态与代际绑定、点击经 canonical 命令、失败只报一次。
 *
 * 断言的是**宿主的可观察行为**：展示项长什么样、run 返回什么码、句柄被调了几次、
 * 旧代际的回调有没有被丢弃——不是内部 map 的形状。
 */

const FILES = SHELL_FILES_VIEW.id;

function entryOf(overrides: Partial<WorkbenchViewEntry> = {}): WorkbenchViewEntry {
    return {
        view: SHELL_FILES_VIEW,
        title: "文件",
        containerId: "nbook.tools",
        order: 10,
        source: "default",
        visible: true,
        visibilityReasons: [],
        actionable: true,
        authorityReasons: [],
        ...overrides,
    };
}

type Harness = {
    readonly actions: WorkbenchViewActionsConsumer;
    readonly registry: CommandRegistry;
    readonly failures: string[];
    readonly entries: Ref<readonly WorkbenchViewEntry[]>;
    stop(): void;
};

function mountActions(options: {handle?: WorkbenchViewActionHandle} = {}): Harness {
    const registry = createCommandRegistry({
        context: () => ({}),
        agentMode: () => "normal",
        development: false,
        report: () => undefined,
    });
    const entries = ref<readonly WorkbenchViewEntry[]>([entryOf()]);
    const failures: string[] = [];
    const scope = effectScope();
    const actions = scope.run(() => useWorkbenchViewActions({
        registry,
        entries: () => entries.value,
        titleOf: () => "刷新",
        onFailure: (diagnosis) => failures.push(diagnosis),
    }))!;
    const registered = registry.registerCommand({
        ...SHELL_FILES_REFRESH_COMMAND.command,
        run: (args) => actions.runAction({viewId: args.viewId, generation: args.generation}, SHELL_FILES_REFRESH_COMMAND.actionId),
    });
    if (registered instanceof Promise || !registered.ok) {
        throw new Error("测试的 View 命令没有注册成功");
    }
    const handle = options.handle ?? {
        runAction: vi.fn(async () => ({ok: true, value: {rows: 3}} as const)),
    };
    actions.bindHandle({viewId: FILES, generation: 1}, handle);
    actions.setStates({viewId: FILES, generation: 1}, [{id: "refresh", enabled: true}]);
    return {actions, registry, failures, entries, stop: () => scope.stop()};
}

describe("useWorkbenchViewActions", () => {
    it("可见视图才有条目：展示项带 target，标题取命令元数据", () => {
        const harness = mountActions();

        const resolved = harness.actions.actionsByView.value[FILES];

        expect(Object.keys(harness.actions.actionsByView.value)).toEqual([FILES]);
        expect(resolved?.target).toEqual({viewId: FILES, generation: 1});
        expect(resolved?.primary.map((item) => item.id)).toEqual(["refresh"]);
        expect(resolved?.primary[0]?.label).toBe("刷新");
        harness.stop();
    });

    it("没有句柄时展示项禁用（尚未就绪），拿到句柄后变可执行", async () => {
        const bare = mountActions();
        bare.actions.bindHandle({viewId: FILES, generation: 1}, null);
        await nextTick();
        expect(bare.actions.actionsByView.value[FILES]?.primary[0]).toMatchObject({disabled: true, reason: "视图操作尚未就绪"});

        bare.actions.bindHandle({viewId: FILES, generation: 1}, {runAction: async () => ({ok: true, value: null})});
        await nextTick();
        expect(bare.actions.actionsByView.value[FILES]?.primary[0]?.disabled).toBeUndefined();
        bare.stop();
    });

    it("点击经 canonical 命令命中句柄，返回值原样返回", async () => {
        const handle = {runAction: vi.fn(async () => ({ok: true, value: {rows: 7}} as const))};
        const harness = mountActions({handle});

        const result = await harness.actions.run({viewId: FILES, generation: 1}, "refresh");

        expect(result).toEqual({ok: true, value: {rows: 7}});
        expect(handle.runAction).toHaveBeenCalledWith("refresh");
        expect(harness.failures).toEqual([]);
        harness.stop();
    });

    it("旧代际的点击被拒：句柄属于更新的实例时，旧 target 是 stale-target", async () => {
        const handle = {runAction: vi.fn(async () => ({ok: true, value: null} as const))};
        const harness = mountActions({handle});
        harness.actions.bindHandle({viewId: FILES, generation: 2}, handle);

        const stale = await harness.actions.run({viewId: FILES, generation: 1}, "refresh");
        const current = await harness.actions.run({viewId: FILES, generation: 2}, "refresh");

        expect(stale).toMatchObject({ok: false, code: "stale-target"});
        expect(current.ok).toBe(true);
        expect(handle.runAction).toHaveBeenCalledTimes(1);
        harness.stop();
    });

    it("迟到的回调被丢弃：旧实例卸载时发的 null 不抹掉新实例的句柄", async () => {
        const handle = {runAction: vi.fn(async () => ({ok: true, value: null} as const))};
        const harness = mountActions({handle});
        harness.actions.bindHandle({viewId: FILES, generation: 2}, handle);
        harness.actions.bindHandle({viewId: FILES, generation: 1}, null);
        harness.actions.setStates({viewId: FILES, generation: 1}, [{id: "refresh", enabled: false, reason: "旧实例"}]);
        await nextTick();

        const result = await harness.actions.run({viewId: FILES, generation: 2}, "refresh");

        expect(result.ok).toBe(true);
        expect(harness.actions.actionsByView.value[FILES]?.primary[0]?.disabled).toBeUndefined();
        harness.stop();
    });

    it("busy 与不可用状态都禁用，点击返回 unavailable 且给出原因", async () => {
        const handle = {runAction: vi.fn(async () => ({ok: true, value: null} as const))};
        const harness = mountActions({handle});
        harness.actions.setStates({viewId: FILES, generation: 1}, [{id: "refresh", enabled: true, busy: true}]);

        const busy = await harness.actions.run({viewId: FILES, generation: 1}, "refresh");
        expect(busy).toEqual({ok: false, code: "unavailable", reason: "视图操作正在执行"});
        expect(harness.failures).toEqual(["视图操作正在执行"]);

        harness.actions.setStates({viewId: FILES, generation: 1}, [{id: "refresh", enabled: false, reason: "文件树正在加载"}]);
        const disabled = await harness.actions.run({viewId: FILES, generation: 1}, "refresh");
        expect(disabled).toEqual({ok: false, code: "unavailable", reason: "文件树正在加载"});
        expect(handle.runAction).not.toHaveBeenCalled();
        harness.stop();
    });

    it("未登记的 actionId 与未上报的状态分别给出自己的原因", async () => {
        const harness = mountActions();

        const unknown = await harness.actions.run({viewId: FILES, generation: 1}, "nope");
        expect(unknown).toMatchObject({ok: false, code: "unavailable"});

        harness.actions.setStates({viewId: FILES, generation: 1}, []);
        const notReady = await harness.actions.run({viewId: FILES, generation: 1}, "refresh");
        expect(notReady).toEqual({ok: false, code: "unavailable", reason: "视图操作尚未就绪"});
        harness.stop();
    });

    it("authority 不足：视图可见但动作不可执行，原因是 authority 的原话", async () => {
        const harness = mountActions();
        harness.entries.value = [entryOf({actionable: false, authorityReasons: ["需要工作区文件 authority"]})];
        await nextTick();

        const result = await harness.actions.run({viewId: FILES, generation: 1}, "refresh");

        expect(result).toEqual({ok: false, code: "unavailable", reason: "需要工作区文件 authority"});
        harness.stop();
    });

    it("视图不可见或实例换了：点击是 stale-target，失败不报到新实例头上", async () => {
        const handle = {runAction: vi.fn(async () => ({ok: false, code: "execution-error", reason: "请求失败"}) as const)};
        const harness = mountActions({handle});

        harness.entries.value = [entryOf({visible: false, visibilityReasons: ["需要打开 Project"]})];
        await nextTick();
        const gone = await harness.actions.run({viewId: FILES, generation: 1}, "refresh");
        expect(gone).toMatchObject({ok: false, code: "stale-target"});
        expect(harness.actions.actionsByView.value[FILES]).toBeUndefined();
        // 视图已经不可见：连失败提示都不该发（那是旧实例的事）。
        expect(harness.failures).toEqual([]);
        harness.stop();
    });

    it("句柄失败：命令结果带原码原因，宿主只报一次", async () => {
        const harness = mountActions({
            handle: {runAction: async () => ({ok: false, code: "unavailable", reason: "文件树正在加载"})},
        });

        const result = await harness.actions.run({viewId: FILES, generation: 1}, "refresh");

        expect(result).toEqual({ok: false, code: "unavailable", reason: "文件树正在加载"});
        expect(harness.failures).toEqual(["文件树正在加载"]);
        harness.stop();
    });

    it("release 清空该代际的句柄与状态：之后再点就是尚未就绪", async () => {
        const harness = mountActions();
        harness.actions.release({viewId: FILES, generation: 1});
        await nextTick();

        expect(harness.actions.actionsByView.value[FILES]?.primary[0]).toMatchObject({disabled: true, reason: "视图操作尚未就绪"});
        const result = await harness.actions.run({viewId: FILES, generation: 1}, "refresh");
        expect(result).toEqual({ok: false, code: "unavailable", reason: "视图操作尚未就绪"});
        harness.stop();
    });

    it("未登记的状态 id 进 issues（忽略但不静默）", () => {
        const harness = mountActions();
        harness.actions.setStates({viewId: FILES, generation: 1}, [
            {id: "refresh", enabled: true},
            {id: "ghost", enabled: true},
        ]);

        expect(harness.actions.issues.value).toEqual([`${FILES} 上报了未登记标题动作的状态：ghost`]);
        harness.stop();
    });

    it("runAction 端口与 run 的区分：端口命中句柄、不重复报失败", async () => {
        const handle = {runAction: vi.fn(async () => ({ok: false, code: "unavailable", reason: "句柄拒绝"}) as const)};
        const harness = mountActions({handle});

        const result = await harness.actions.runAction({viewId: FILES, generation: 1}, "refresh");

        expect(result).toEqual({ok: false, code: "unavailable", reason: "句柄拒绝"});
        expect(harness.failures).toEqual([]);
        harness.stop();
    });

    it("命令注册在别处的调用（带参数直接执行）同样命中句柄", async () => {
        const handle = {runAction: vi.fn(async () => ({ok: true, value: null} as const))};
        const harness = mountActions({handle});

        const result = await harness.registry.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: FILES, generation: 1});

        expect(result.ok).toBe(true);
        expect(handle.runAction).toHaveBeenCalledWith("refresh");
        harness.stop();
    });

    it("命令参数里的代际与句柄不符时拒绝执行", async () => {
        const handle = {runAction: vi.fn(async () => ({ok: true, value: null} as const))};
        const harness = mountActions({handle});

        const result = await harness.registry.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: FILES, generation: 9});

        expect(result).toMatchObject({ok: false, code: "stale-target"});
        expect(handle.runAction).not.toHaveBeenCalled();
        harness.stop();
    });

    it("目标在请求期间被换掉：成功不误报、失败也不回给新实例", async () => {
        const gate = Promise.withResolvers<{ok: true; value: null}>();
        const harness = mountActions({handle: {runAction: () => gate.promise}});

        const pending = harness.actions.run({viewId: FILES, generation: 1}, "refresh");
        harness.actions.release({viewId: FILES, generation: 1});
        await nextTick();
        gate.resolve({ok: true, value: null});

        expect(await pending).toEqual({ok: true, value: null});
        expect(harness.failures).toEqual([]);
        harness.stop();
    });

    it("target 类型是渲染时捕获的：actionsByView 给出当前代际，供宿主在渲染时绑定", () => {
        const harness = mountActions();
        const target: ViewActionTarget = harness.actions.actionsByView.value[FILES]!.target;

        expect(target).toEqual({viewId: FILES, generation: 1});
        harness.stop();
    });
});
