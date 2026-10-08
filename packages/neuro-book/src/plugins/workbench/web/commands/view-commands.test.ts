/**
 * 移动视图命令（docs/specs/workbench/commands.md 第二批，docs/specs/ui/workbench-shell.md 外壳二输出 24，验收 27）：真实的
 * 布局 store（Storage 场地），命令实现直接调用；选择服务由测试按请求作答（产品里是命令面板，经面板执行的路径由
 * `e2e/workbench-views.e2e.ts` 覆盖）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {shallowRef} from "@vue/reactivity";

import type {ContextKeySource} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import {textOf} from "nbook/shared/localized-text";

import type {QuickPick, QuickPickRequest, QuickPickResult} from "../../shared/contracts";
import type {ViewDeclaration, ViewLocation} from "../../shared/views";
import type {LayoutStore} from "../state/layout-store";
import {workbenchStateBindings} from "../state/public-state";
import {openLayout} from "../testing/layout";
import {MOVE_VIEW_COMMAND, VIEW_COMMAND_DECLARATIONS, viewCommands} from "./view-commands";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "view-commands");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const view = (name: string, location: ViewLocation, extra: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: {"zh-CN": name, "en-US": name}, icon: `i-${name}`, location, layout: "scroll", ...extra});

async function layout(): Promise<LayoutStore> {
    counter += 1;
    const w = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(w);
    const {store} = await openLayout(w, "w", "c");
    store.actions.acceptViewCatalog(new Map([["test.a", view("A", "sidebar")], ["test.b", view("B", "sidebar")], ["test.c", view("C", "panel")], ["test.d", view("D", "sidebar", {movable: false})]]));
    return store;
}

function picker(answer: (request: QuickPickRequest, index: number) => QuickPickResult | Promise<QuickPickResult>): QuickPick & {readonly requests: QuickPickRequest[]} {
    const requests: QuickPickRequest[] = [];
    return {requests, pick: async (request) => {
        requests.push(request);
        return answer(request, requests.length - 1);
    }};
}

const labels = (request: QuickPickRequest | undefined): string[] => (request?.items ?? []).map((item) => `${item.id}:${textOf(item.label, "zh-CN")}${item.detail === undefined ? "" : `/${textOf(item.detail, "zh-CN")}`}`);

const run = (store: LayoutStore, quickPick: QuickPick, args: Record<string, unknown>) => viewCommands(() => store, quickPick)[MOVE_VIEW_COMMAND].run(args);

describe("移动视图", () => {
    it("经真实命令注册表登记；布局没打开时不可用，打开后可用", async () => {
        const store = await layout();
        const current = shallowRef<LayoutStore | null>(null);
        const bindings = workbenchStateBindings(current) as unknown as Readonly<Record<string, {readonly value: unknown}>>;
        const nameOf = (key: string): string => key.slice("nbook.workbench/".length);
        const contextKeys: ContextKeySource = {
            problem: (key) => (key.startsWith("nbook.workbench/") && nameOf(key) in bindings ? null : `${key} 不是工作台的公开键`),
            evaluate: (key) => (bindings[nameOf(key)]?.value === true ? {matches: true} : {matches: false, reason: key}),
        };
        const registry = createCommandRegistry({contextKeys, report: (error) => {
            throw error;
        }});
        const registered = registry.register({id: MOVE_VIEW_COMMAND, source: "nbook.workbench", declaration: VIEW_COMMAND_DECLARATIONS[MOVE_VIEW_COMMAND], run: viewCommands(() => current.value, picker(() => ({kind: "cancelled"})))[MOVE_VIEW_COMMAND].run});
        expect(registered.ok).toBe(true);
        expect(registry.isEnabled(MOVE_VIEW_COMMAND)).toMatchObject({ok: false, code: "unavailable"});
        current.value = store;
        expect(registry.isEnabled(MOVE_VIEW_COMMAND)).toEqual({ok: true, value: true});
    });

    it("三项参数直接移动；只给一部分为 invalid-args；来源已变为 stale-target 且不写；不可移动、目标不存在为 invalid-args", async () => {
        const store = await layout();
        const silent = picker(() => ({kind: "cancelled"}));
        expect(await run(store, silent, {viewId: "test.b", targetContainerId: "view:test.a"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await run(store, silent, {viewId: "test.b", sourceContainerId: "view:test.b", targetContainerId: "view:test.a"})).toEqual({ok: true, value: null});
        expect(store.state.placement.views.get("test.b")?.container).toBe("view:test.a");
        expect(store.state.placement.selected.sidebar).toBe("view:test.a");
        await waitUntil("保存完成", () => store.state.customizations.queue === 0);
        const before = structuredClone(store.state.customizations.display);
        expect(await run(store, silent, {viewId: "test.b", sourceContainerId: "view:test.b", targetContainerId: "view:test.c"})).toMatchObject({ok: false, code: "stale-target"});
        expect(await run(store, silent, {viewId: "test.d", sourceContainerId: "view:test.d", targetContainerId: "view:test.a"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await run(store, silent, {viewId: "test.a", sourceContainerId: "view:test.a", targetContainerId: "view:nope"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await run(store, silent, {viewId: "test.a", sourceContainerId: "view:test.a", targetContainerId: "view:test.a"})).toEqual({ok: true, value: null});
        expect(store.state.customizations.display).toEqual(before);
        expect(store.state.customizations.queue).toBe(0);
        expect(silent.requests).toEqual([]);
    });

    it("无参：先选视图、再选目标（含同一 Part 的容器与重置位置）；取消任一步成功且不写", async () => {
        const store = await layout();
        const cancelFirst = picker(() => ({kind: "cancelled"}));
        expect(await run(store, cancelFirst, {})).toEqual({ok: true, value: null});
        // 不可移动的 D 不在候选里。
        expect(labels(cancelFirst.requests[0])).toEqual(["test.a:A/A", "test.b:B/B", "test.c:C/C"]);

        const cancelSecond = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "cancelled"}));
        expect(await run(store, cancelSecond, {})).toEqual({ok: true, value: null});
        expect(labels(cancelSecond.requests[1])).toEqual(["view:test.b:B/侧栏", "view:test.d:D/侧栏", "view:test.c:C/面板"]);
        expect(store.state.customizations.queue).toBe(0);

        const move = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "item", id: "view:test.b"}));
        expect(await run(store, move, {})).toEqual({ok: true, value: null});
        expect(store.state.placement.views.get("test.a")?.container).toBe("view:test.b");

        const reset = picker((request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "item", id: request.items.at(-1)!.id}));
        expect(await run(store, reset, {})).toEqual({ok: true, value: null});
        expect(labels(reset.requests[1]).at(-1)).toBe("reset::重置位置");
        expect(store.state.placement.views.get("test.a")?.container).toBe("view:test.a");
    });

    it("两步选择之间视图被别处移走：按 stale-target 拒绝且不写", async () => {
        const store = await layout();
        const racing = picker((_request, index) => {
            if (index === 0) return {kind: "item", id: "test.a"};
            store.actions.applyView({kind: "move-view", viewId: "test.a", sourceContainerId: "view:test.a", targetContainerId: "view:test.c"});
            return {kind: "item", id: "view:test.b"};
        });
        expect(await run(store, racing, {})).toMatchObject({ok: false, code: "stale-target"});
        expect(store.state.placement.views.get("test.a")?.container).toBe("view:test.c");
    });

    it("选择服务不可用为 unavailable；外壳没打开为 unavailable", async () => {
        const store = await layout();
        expect(await run(store, picker(() => ({kind: "unavailable", reason: "没有命令面板"})), {})).toEqual({ok: false, code: "unavailable", reason: "没有命令面板"});
        expect(await viewCommands(() => null, picker(() => ({kind: "cancelled"})))[MOVE_VIEW_COMMAND].run({})).toMatchObject({ok: false, code: "unavailable"});
    });
});
