/**
 * 场景 3：贡献点（`menu` 定义并接收，`file-menu` 贡献）。
 *
 * 要说明的事：
 * - 声明在登记时逐条校验：不合格的只拒绝那一条，原因可以从目录查到，查询不激活任何插件。
 * - 贡献方发布后，菜单项交到拥有者手里、可以执行；贡献方停止后撤回，拥有者与别的贡献方不受影响。
 * - 声明与实现分开：贡献方还没激活时，它的声明已经被接受，拥有者经 `context.declarations` 列得出标题，只是还不能执行。
 *
 * 阅读顺序：`plugins/menu/shared/contracts.ts` → `plugins/menu/backend/plugin.ts` → `plugins/file-menu/backend/plugin.ts`
 * → 这里。
 *
 * 行为合同：docs/specs/runtime/plugins.md 输出第 15–18、23、24 条。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {fileMenuBackendPlugin} from "../plugins/file-menu/backend/plugin";
import {menuBackendPlugin} from "../plugins/menu/backend/plugin";
import {MENU_POINT, menuKey} from "../plugins/menu/shared/contracts";
import {serviceProbe} from "../testing/probes";
import {Stage} from "../testing/stage";

let tmp = "";
let cases = 0;
const stages: Stage[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-examples", "示例场景 3：贡献点");
});

afterEach(async () => {
    for (const stage of stages.splice(0)) {
        for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function newStage(): Stage {
    cases += 1;
    const stage = new Stage(join(tmp, `case-${String(cases)}`));
    stages.push(stage);
    return stage;
}

/**
 * 一个写错了的贡献方：一条没有标题，一条 id 没以本插件 id 开头。两条都被拒，被拒的贡献不要求实现（docs/specs/runtime/plugins.md
 * 输出第 15 条），所以它什么也不交；`defineEntry` 按声明要求两条都有实现，这里不用它。
 */
const careless: PluginDefinition = {
    id: "example.careless",
    entries: [{
        id: "server",
        location: "server",
        activationEvents: ["onStartup"],
        contributions: [
            {capability: MENU_POINT, id: "example.careless.untitled", declaration: {title: " "}},
            {capability: MENU_POINT, id: "open", declaration: {title: "打开"}},
        ],
        activate: () => ({}),
    }],
};

/** 一个贡献方：`activationEvents` 由调用方给，用来分别演示启动即激活与还没激活。 */
function contributor(id: string, activationEvents: ReadonlyArray<string>): PluginDefinition {
    return {
        id,
        entries: [defineEntry({
            id: "server",
            location: "server",
            activationEvents,
            contributions: [{capability: MENU_POINT, id: `${id}.run`, declaration: {title: `${id} 的菜单项`}}],
            activate: () => ({contributions: {[MENU_POINT]: {[`${id}.run`]: {run: async () => `${id} 执行了`}}}}),
        })],
    };
}

describe("场景 3：贡献点", () => {
    it("通过校验的菜单项交给菜单并可执行；不合格的只拒绝那一条，原因可以从目录查到", async () => {
        const stage = newStage();
        const shell = serviceProbe("example.shell", "server", [menuKey]);
        const {app} = await stage.server({plugins: [menuBackendPlugin, fileMenuBackendPlugin, careless, shell.definition]});
        const menu = shell.get(menuKey);

        expect(await menu.items()).toEqual([{id: "example.file-menu.open", title: "打开文件"}, {id: "example.file-menu.close", title: "关闭文件"}]);
        expect(await menu.run("example.file-menu.open")).toEqual({ok: true, value: "已打开"});
        expect(await menu.run("open")).toEqual({ok: false, code: "unknown-item"});
        // 目录查询不激活任何插件，被拒的原因写在校验结果里。
        expect(app.plugins.contribution(MENU_POINT, "example.careless.untitled")[0]?.validation).toEqual({status: "rejected", reason: "invalid-declaration", detail: "菜单项要有标题"});
        expect(app.plugins.contribution(MENU_POINT, "open")[0]?.validation).toMatchObject({status: "rejected", reason: "invalid-declaration"});
    });

    it("贡献方停止后它的菜单项撤回：不再列出、执行为 unknown-item；菜单与别的贡献方照常", async () => {
        const stage = newStage();
        const shell = serviceProbe("example.shell", "server", [menuKey]);
        const {app} = await stage.server({plugins: [menuBackendPlugin, fileMenuBackendPlugin, shell.definition]});
        const menu = shell.get(menuKey);
        const edit = await stage.attach(app, contributor("example.edit-menu", []), "server");
        expect(await menu.run("example.edit-menu.run")).toEqual({ok: true, value: "example.edit-menu 执行了"});

        expect((await edit.stop()).status).toBe("closed");
        expect((await menu.items()).map((item) => item.id)).toEqual(["example.file-menu.open", "example.file-menu.close"]);
        expect(await menu.run("example.edit-menu.run")).toEqual({ok: false, code: "unknown-item"});
        expect(await menu.run("example.file-menu.close")).toEqual({ok: true, value: "已关闭"});
    });

    it("贡献方还没激活：它的声明已被接受，菜单经 context.declarations 列得出标题，只是还不能执行", async () => {
        const stage = newStage();
        const shell = serviceProbe("example.shell", "server", [menuKey]);
        // 不写激活事件、也没人依赖它：这个贡献方一直不激活。
        const {app} = await stage.server({plugins: [menuBackendPlugin, fileMenuBackendPlugin, careless, contributor("example.recent", []), shell.definition]});
        const menu = shell.get(menuKey);

        expect(app.plugins.entryState({plugin: "example.recent", entry: "server"})?.status).toBe("registered");
        // 已接受的声明按贡献 id 排序；被拒的两条不在里面。
        expect(await menu.titles()).toEqual([
            {id: "example.file-menu.close", title: "关闭文件", plugin: "example.file-menu"},
            {id: "example.file-menu.open", title: "打开文件", plugin: "example.file-menu"},
            {id: "example.recent.run", title: "example.recent 的菜单项", plugin: "example.recent"},
        ]);
        expect((await menu.items()).map((item) => item.id)).not.toContain("example.recent.run");
        expect(await menu.run("example.recent.run")).toEqual({ok: false, code: "unknown-item"});
    });
});
