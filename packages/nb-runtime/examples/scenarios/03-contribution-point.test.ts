/**
 * 场景 3：贡献点（`menu` 定义、`file-menu` 贡献）。读法：先读 `plugins/menu/`、`plugins/file-menu/`，再读这里。
 * 行为合同：docs/specs/runtime/plugins.md 输出第 15–18 条。
 */

import {afterEach, expect, it} from "bun:test";

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createFileMenuServerPlugin} from "../plugins/file-menu/server/plugin";
import {MENU_POINT, menuKey} from "../plugins/menu/shared/contracts";
import {createMenuServerPlugin} from "../plugins/menu/server/plugin";
import {Stage} from "./hosts";
import {serviceProbe} from "./probes";

const stage = new Stage();

afterEach(async () => {
    for (const result of await stage.close()) expect(result).toEqual({status: "closed"});
});

/** 一个写错了的贡献方：一条没有标题，一条 id 没以本插件 id 开头。 */
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
        // 两条都被拒，不要求实现。
        activate: () => ({}),
    }],
};

it("场景 3：通过校验的菜单项交给菜单并可执行；不合格的只拒绝那一条，原因可从目录查到", async () => {
    const shell = serviceProbe("example.shell", "server", [menuKey]);
    const app = await stage.local({plugins: [createMenuServerPlugin(), createFileMenuServerPlugin(), careless, shell.definition], keys: [menuKey]});
    const menu = shell.get(menuKey);

    expect(menu.items()).toEqual([{id: "example.file-menu.open", title: "打开文件"}, {id: "example.file-menu.close", title: "关闭文件"}]);
    expect(menu.run("example.file-menu.open")).toBe("已打开");
    expect(menu.run("open")).toBeNull();
    // 目录查询不激活任何插件。
    expect(app.plugins.contribution(MENU_POINT, "example.careless.untitled")[0]?.validation).toEqual({status: "rejected", reason: "invalid-declaration", detail: "菜单项要有标题"});
    expect(app.plugins.contribution(MENU_POINT, "open")[0]?.validation).toMatchObject({status: "rejected", reason: "invalid-declaration"});
});
