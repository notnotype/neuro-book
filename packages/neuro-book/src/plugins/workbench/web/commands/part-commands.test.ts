/**
 * 区域显隐与应用命令（docs/specs/ui/workbench-layout.md 输出 11、35，docs/specs/ui/workbench-shell.md 外壳四输出 32，
 * docs/specs/workbench/commands.md 第二批与“命令目录（应用）”）：真实的一棵树的布局 store（Storage 场地）；选择服务由测试按请求
 * 作答，宿主的整页导航由测试记下请求（产品里是 `location.reload` 与 `window.open`，真实浏览器的路径由
 * `e2e/workbench-shell.e2e.ts` 覆盖）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {shallowRef} from "@vue/reactivity";

import {validateLayoutDoc} from "@notnotype/nb-layout";
import type {LayoutDoc} from "@notnotype/nb-layout";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {commandDeclarationProblems} from "nbook/plugins/commands/shared/registry";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import type {WindowNavigation} from "nbook/shared/host";
import type {StorageService} from "nbook/shared/storage";

import type {QuickPick, QuickPickRequest, QuickPickResult} from "../../shared/contracts";
import type {LayoutDocStore} from "../state/layout-doc-store";
import {LAYOUT_DOC_RECORDS} from "../state/records";
import {workbenchState, workbenchStateBindings} from "../state/public-state";
import {openLayoutDoc} from "../testing/layout-doc";
import {APP_COMMAND_DECLARATIONS, appCommands, DOCUMENTATION_COMMAND, DOCUMENTATION_URL, RELOAD_COMMAND} from "./app-commands";
import {PART_COMMAND_DECLARATIONS, partCommands, SET_PART_HIDDEN_COMMAND} from "./part-commands";
import {completedCommand} from "../../testing/declarations";
import {failureText, workbenchTestText} from "../../testing/text";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "part-commands");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function layout(): Promise<{store: LayoutDocStore; storage: StorageService}> {
    counter += 1;
    const world = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(world);
    const {store, storage} = await openLayoutDoc(world, "w", "c");
    return {store, storage};
}

function picker(answer: (request: QuickPickRequest) => QuickPickResult): QuickPick & {readonly requests: QuickPickRequest[]} {
    const requests: QuickPickRequest[] = [];
    return {requests, pick: async (request) => {
        requests.push(request);
        return answer(request);
    }};
}

/** 立刻存，等保存完成，读回已确认的布局文档。 */
async function savedLayout(store: LayoutDocStore, storage: StorageService): Promise<LayoutDoc> {
    await store.actions.save();
    await waitUntil("布局保存完成", () => store.state.field.queue === 0);
    const opened = await storage.open(LAYOUT_DOC_RECORDS.user);
    if (!opened.ok) throw new Error(opened.detail);
    const snapshot = await opened.handle.read();
    if (snapshot.status !== "ok") throw new Error(`记录是 ${snapshot.status}`);
    const checked = validateLayoutDoc(snapshot.value.doc);
    if (!checked.ok) throw new Error(checked.detail);
    return checked.doc;
}

describe("声明", () => {
    it("区域显隐与两条应用命令的声明通过命令系统的校验；when 只引用工作台声明的公开键", () => {
        const declared = new Set((Object.keys(workbenchState.declarations) as (keyof typeof workbenchState.declarations)[]).map((name) => workbenchState.key(name)));
        for (const [id, declaration] of Object.entries({...PART_COMMAND_DECLARATIONS, ...APP_COMMAND_DECLARATIONS})) {
            expect(commandDeclarationProblems(id, "nbook.workbench", completedCommand(id, declaration)), id).toEqual([]);
            for (const key of ("when" in declaration ? declaration.when.requires : [])) expect(declared.has(key), key).toBe(true);
        }
    });
});

describe("区域显隐", () => {
    it("带 part 时按可见切换；“显示”同时清掉隐藏与拖到零；可见性公开键随之变化；同值操作不写入", async () => {
        const {store, storage} = await layout();
        const keys = workbenchStateBindings(shallowRef<LayoutDocStore | null>(store));
        const commands = partCommands(() => store, picker(() => ({kind: "cancelled"})));
        expect([keys.sidebarVisible.value, keys.auxiliaryBarVisible.value, keys.activityBarVisible.value, keys.panelVisible.value]).toEqual([true, true, true, true]);

        await commands[SET_PART_HIDDEN_COMMAND].run({part: "sidebar"});
        expect(keys.sidebarVisible.value).toBe(false);
        await commands[SET_PART_HIDDEN_COMMAND].run({part: "sidebar"});
        expect(keys.sidebarVisible.value).toBe(true);

        // 横向分支里拖到零：没隐藏但看不见；切换按“可见”判断，所以这一次是显示，并清掉拖到零。
        store.actions.setCollapsed("auxiliarybar", true);
        expect(keys.auxiliaryBarVisible.value).toBe(false);
        await commands[SET_PART_HIDDEN_COMMAND].run({part: "auxiliarybar"});
        expect(keys.auxiliaryBarVisible.value).toBe(true);
        expect(store.state.doc.panels.auxiliarybar?.collapsed).toBeFalsy();

        // 隐藏与收起同时为真时，“显示”把两个都清掉（输出 11）。
        store.actions.setCollapsed("panel", true);
        await commands[SET_PART_HIDDEN_COMMAND].run({part: "panel", hidden: true});
        expect(store.state.doc.panels.panel).toMatchObject({hidden: true, collapsed: true});
        await commands[SET_PART_HIDDEN_COMMAND].run({part: "panel", hidden: false});
        expect(store.state.doc.panels.panel?.hidden).toBeFalsy();
        expect(store.state.doc.panels.panel?.collapsed).toBeFalsy();
        expect(keys.panelVisible.value).toBe(true);

        await commands[SET_PART_HIDDEN_COMMAND].run({part: "activitybar", hidden: true});
        expect(keys.activityBarVisible.value).toBe(false);
        await commands[SET_PART_HIDDEN_COMMAND].run({part: "statusbar", hidden: true});
        const hiddenOnce = await savedLayout(store, storage);
        expect(hiddenOnce.hiddenBars).toEqual(["activitybar", "statusbar"]);
        // 同值再来一次：命令成功，已确认的记录没有新的写入。
        const revision = store.state.field.base?.status === "ok" ? store.state.field.base.revision : null;
        expect(await commands[SET_PART_HIDDEN_COMMAND].run({part: "activitybar", hidden: true})).toEqual({ok: true, value: null});
        await store.actions.save();
        await waitUntil("布局保存完成", () => store.state.field.queue === 0);
        expect(store.state.field.base?.status === "ok" ? store.state.field.base.revision : null).toBe(revision);
    });

    it("隐藏最大化着的面板时退出最大化（输出 13）", async () => {
        const {store} = await layout();
        const commands = partCommands(() => store, picker(() => ({kind: "cancelled"})));
        store.actions.toggleMaximized("panel");
        expect(store.state.maximized).toBe("panel");
        await commands[SET_PART_HIDDEN_COMMAND].run({part: "panel", hidden: true});
        expect(store.state.maximized).toBeNull();
    });

    it("省略 part 时先选区域并标出可见与否，选中即切换；取消不写；选择服务不可用为 unavailable；外壳没挂载为 unavailable", async () => {
        const {store} = await layout();
        store.actions.setPartHidden("activitybar", true);
        const choose = picker(() => ({kind: "item", id: "activitybar"}));
        const commands = partCommands(() => store, choose);
        expect(await commands[SET_PART_HIDDEN_COMMAND].run({})).toEqual({ok: true, value: null});
        expect(choose.requests[0]!.items.map((item) => [item.id, item.detail === undefined ? null : workbenchTestText("zh-CN").t(item.detail)])).toEqual([["sidebar", "显示中"], ["auxiliarybar", "显示中"], ["panel", "显示中"], ["activitybar", "已隐藏"], ["statusbar", "显示中"]]);
        expect(store.actions.partVisible("activitybar")).toBe(true);

        expect(await partCommands(() => store, picker(() => ({kind: "cancelled"})))[SET_PART_HIDDEN_COMMAND].run({})).toEqual({ok: true, value: null});
        expect(store.actions.partVisible("sidebar")).toBe(true);
        expect(await partCommands(() => store, picker(() => ({kind: "unavailable", reason: "没有面板"})))[SET_PART_HIDDEN_COMMAND].run({})).toEqual({ok: false, code: "unavailable", reason: "没有面板"});
        const notOpen = await partCommands(() => null, choose)[SET_PART_HIDDEN_COMMAND].run({part: "sidebar"});
        expect(notOpen).toMatchObject({ok: false, code: "unavailable"});
        expect(failureText(notOpen, "zh-CN")).toBe("工作台布局没有打开（这个窗口没有显示外壳）");
        expect(failureText(notOpen, "en-US")).toBe("The workbench layout is not open (this window does not show the shell)");
    });
});

describe("应用命令", () => {
    function navigation(open: "opened" | "blocked"): WindowNavigation & {readonly requests: string[]} {
        const requests: string[] = [];
        return {requests, navigateDocument: (href) => requests.push(`assign ${href}`), reloadDocument: () => requests.push("reload"), openExternal: (href) => {
            requests.push(`open ${href}`);
            return open;
        }, currentUrl: () => "http://localhost/", replaceUrl: () => undefined};
    }

    it("重新载入只请求宿主重新载入当前文档；文档在新标签打开文档站，被拦截时 unavailable 并说明", async () => {
        const host = navigation("opened");
        const commands = appCommands(host);
        expect(await commands[RELOAD_COMMAND].run({})).toEqual({ok: true, value: null});
        expect(await commands[DOCUMENTATION_COMMAND].run({})).toEqual({ok: true, value: null});
        expect(host.requests).toEqual(["reload", `open ${DOCUMENTATION_URL}`]);

        const blocked = await appCommands(navigation("blocked"))[DOCUMENTATION_COMMAND].run({});
        expect(blocked).toMatchObject({ok: false, code: "unavailable"});
        expect(failureText(blocked, "zh-CN")).toBe("浏览器拦截了新标签页；请允许本站打开弹出窗口后再试");
        expect(failureText(blocked, "en-US")).toBe("The browser blocked the new tab; allow pop-ups for this site and try again");
    });
});
