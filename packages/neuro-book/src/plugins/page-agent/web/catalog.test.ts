/** 界面目录的拼装（docs/specs/agent/page-agent.md 输出 7）：设置、节、视图与命令的路径，排序与限定种类，走到中途时从哪一步给起。 */

import {describe, expect, it} from "bun:test";

import type {Locator} from "@notnotype/nb-page-agent/api";

import {TOGGLE_SETTINGS_COMMAND} from "nbook/plugins/settings/shared/contracts";
import type {SettingsCatalogView} from "nbook/plugins/settings/shared/contracts";
import type {WorkbenchCatalogView} from "nbook/plugins/workbench/shared/contracts";

import {findInCatalog} from "./catalog";
import type {CatalogCommand, CatalogSources} from "./catalog";

const SETTINGS: SettingsCatalogView = {
    bound: true,
    layer: "project",
    layerTitles: {user: "用户", project: "作品"},
    sections: [
        {id: "nbook.appearance", title: "外观", kind: "list", layers: ["user"], keywords: []},
        {id: "nbook.models", title: "模型", kind: "page", layers: ["user"], keywords: ["服务商"]},
    ],
    settings: [
        {key: "nbook.workbench/theme", title: "主题", description: "界面的配色", section: "nbook.appearance", layers: ["user"]},
        {key: "nbook.editor/font", title: "正文字体", description: null, section: "nbook.appearance", layers: ["user", "project"]},
    ],
};

const WORKBENCH: WorkbenchCatalogView = {
    views: [
        {id: "nbook.files.explorer", title: "文件", container: "nbook.project", actions: ["nbook.files.new"]},
        {id: "nbook.agent.chat", title: "对话", container: null, actions: []},
    ],
    containers: [{id: "nbook.project", title: "项目", region: "sidebar", views: ["nbook.files.explorer"]}],
    activityItems: [{id: "nbook.settings", title: "设置", command: TOGGLE_SETTINGS_COMMAND}],
};

const COMMANDS: Readonly<Record<string, CatalogCommand>> = {
    [TOGGLE_SETTINGS_COMMAND]: {id: TOGGLE_SETTINGS_COMMAND, title: "打开设置", keybinding: "Ctrl+,", palette: true},
    "nbook.files.new": {id: "nbook.files.new", title: "新建文件", keybinding: null, palette: false},
};

function sources(present: (locator: Locator) => boolean = () => false, settings: SettingsCatalogView = SETTINGS): CatalogSources {
    return {settings, workbench: WORKBENCH, command: (id) => COMMANDS[id] ?? null, present};
}

describe("界面目录（输出 7）", () => {
    it("设置的路径：活动栏的设置项 → 层（当前层不支持时）→ 节 → 行，每步写明点完出现什么", () => {
        const [theme] = findInCatalog(sources(), "主题", "setting", 5);
        expect(theme).toEqual({
            kind: "setting", title: "主题", description: "界面的配色", id: "nbook.workbench/theme",
            path: [
                {at: {target: "workbench.activity", key: "nbook.settings"}, appears: {target: "settings.section", key: "nbook.appearance"}},
                {at: {role: "radio", name: "用户", exact: true, within: {target: "settings.layers"}}, appears: null},
                {at: {target: "settings.section", key: "nbook.appearance"}, appears: {target: "settings.row", key: "nbook.workbench/theme"}},
                {at: {target: "settings.row", key: "nbook.workbench/theme"}, appears: null},
            ],
        });
        // 两层都支持的设置沿用当前层，没有换层这一步。
        const [font] = findInCatalog(sources(), "正文字体", "setting", 5);
        expect(font!.path.map((step) => step.at)).toEqual([
            {target: "workbench.activity", key: "nbook.settings"},
            {target: "settings.section", key: "nbook.appearance"},
            {target: "settings.row", key: "nbook.editor/font"},
        ]);
    });

    it("设置窗口已经开着时从节给起；已经在那一行时只剩最后一步", () => {
        const open = (locator: Locator) => locator.target === "settings.section";
        const [opened] = findInCatalog(sources(open, {...SETTINGS, layer: "user"}), "主题", "setting", 5);
        expect(opened!.path.map((step) => step.at)).toEqual([{target: "settings.section", key: "nbook.appearance"}, {target: "settings.row", key: "nbook.workbench/theme"}]);
        const there = (locator: Locator) => locator.target === "settings.section" || locator.target === "settings.row";
        const [arrived] = findInCatalog(sources(there, {...SETTINGS, layer: "user"}), "主题", "setting", 5);
        expect(arrived!.path.map((step) => step.at)).toEqual([{target: "settings.row", key: "nbook.workbench/theme"}]);
    });

    it("节止于节，按搜索词也能找到；没打开作品的窗口只收用户层的", () => {
        const [models] = findInCatalog(sources(), "服务商", "section", 5);
        expect(models).toMatchObject({kind: "section", title: "模型", id: "nbook.models"});
        expect(models!.path.at(-1)).toEqual({at: {target: "settings.section", key: "nbook.models"}, appears: null});
        const unbound = {...SETTINGS, bound: false, settings: [...SETTINGS.settings, {key: "x.only-project", title: "作品专用", description: null, section: "nbook.appearance", layers: ["project" as const]}]};
        expect(findInCatalog(sources(() => false, unbound), "作品专用", undefined, 5)).toEqual([]);
        // 没打开作品时没有层切换。
        expect(findInCatalog(sources(() => false, unbound), "主题", "setting", 5)[0]!.path.some((step) => step.at.role === "radio")).toBe(false);
    });

    it("视图经它所在的容器入口；按容器标题也能找到；不在容器里的视图只有它自己", () => {
        const [files] = findInCatalog(sources(), "项目", "view", 5);
        expect(files).toMatchObject({kind: "view", id: "nbook.files.explorer", path: [
            {at: {target: "workbench.container", key: "nbook.project"}, appears: {target: "workbench.view", key: "nbook.files.explorer"}},
            {at: {target: "workbench.view", key: "nbook.files.explorer"}, appears: null},
        ]});
        expect(findInCatalog(sources(), "对话", "view", 5)[0]!.path).toEqual([{at: {target: "workbench.view", key: "nbook.agent.chat"}, appears: null}]);
    });

    it("命令只收活动栏与视图标题栏上的，带快捷键与能否从命令面板运行", () => {
        const commands = findInCatalog(sources(), "新建", "command", 5);
        expect(commands).toEqual([{
            kind: "command", title: "新建文件", id: "nbook.files.new", palette: false,
            path: [
                {at: {target: "workbench.container", key: "nbook.project"}, appears: {target: "command", key: "nbook.files.new"}},
                {at: {target: "command", key: "nbook.files.new"}, appears: null},
            ],
        }]);
        expect(findInCatalog(sources(), "打开设置", "command", 5)).toEqual([{
            kind: "command", title: "打开设置", id: TOGGLE_SETTINGS_COMMAND, keybinding: "Ctrl+,", palette: true,
            path: [{at: {target: "workbench.activity", key: "nbook.settings"}, appears: null}],
        }]);
    });

    it("按命令面板的打分排序（开头匹配在前），同名的不同种类分开列，至多 limit 条", () => {
        const all = findInCatalog(sources(), "设置", undefined, 10);
        expect(all.map((entry) => entry.kind)).toEqual(["command"]);
        const both = findInCatalog(sources(), "文件", undefined, 10);
        expect(both.map((entry) => [entry.kind, entry.title])).toEqual([["view", "文件"], ["command", "新建文件"]]);
        expect(findInCatalog(sources(), "文件", undefined, 1)).toHaveLength(1);
    });
});
