/**
 * 内置插件的贡献点都不让第三方插件占用别人的名字（docs/specs/runtime/plugins.md 输出 15）：产品定义表里的每个贡献点，
 * 第三方插件贡献一条以别的插件 id 开头的 id，都被拒绝，原因是前缀。前缀多由贡献点的 `idPrefix` 交给内核核对；不按插件 id
 * 取 id 的贡献点列在 `OWN_ID_RULES`，各有自己的规则与测试。新加的贡献点自动进这份测试。
 */

import {afterEach, describe, expect, it} from "bun:test";

import type {Application} from "@notnotype/nb-runtime/application";
import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";
import type {ContributionPointDefinition, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createApplication} from "nbook/application";
import {projectPluginDefinitions} from "nbook/project/plugins";
import {serverPluginDefinitions} from "nbook/server/plugins";
import {browserPluginDefinitions} from "nbook/web/plugins";

/** 贡献 id 不按插件 id 取的贡献点，与它们的 id 规则所在。 */
const OWN_ID_RULES: Readonly<Record<string, string>> = {
    "workbench.themes": "无点 id 只有 nbook.workbench 能用，其余以插件 id 加点开头（theme/skins.md，workbench/themes.test.ts）",
    "state.public": "公开键按插件 id 加 `/`（state/public-state.md）",
    "commands.definitions": "命令 id 按域词表（workbench/commands.md）",
    "workbench.pages": "页面路径（ui/workbench-shell.md）",
    "workbench.editor-area": "只取一个提供者（ui/workbench-layout.md）",
    "workbench.home": "只取一个提供者（ui/workbench-shell.md）",
    "settings.properties": "配置项 id 按插件 id 加 `/`（settings/configuration.md）",
    "markdown.dialects": "方言名（ui/markdown-dialects）",
    "markdown.syntaxes": "语法名（ui/markdown-dialects）",
    "editor.languages": "语言 id（workbench/editor.md）",
    "files.schemes": "方案名，只接受内置插件注册（workspace/resources.md 的“方案注册”，files/schemes.test.ts）",
};

const INTRUDER = "acme.intruder";

const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

/** 只收声明的贡献点（`implementation: "none"`）的贡献写在插件定义的顶层，其余写在入口里。 */
function intruder(point: ContributionPointDefinition, location: RuntimeLocation): PluginDefinition {
    const contribution = {capability: point.id, id: "nbook.intruder", declaration: {}};
    if (point.implementation === "none") return {id: INTRUDER, contributions: [contribution], entries: []};
    return {id: INTRUDER, entries: [{id: location, location, activationEvents: [], contributions: [contribution], activate: () => ({})}]};
}

const TABLES: ReadonlyArray<{readonly location: RuntimeLocation; readonly definitions: Readonly<Record<string, PluginDefinition>>}> = [
    {location: "browser", definitions: browserPluginDefinitions},
    {location: "server", definitions: serverPluginDefinitions},
    {location: "project", definitions: projectPluginDefinitions},
];

describe("内置贡献点的贡献 id 前缀", () => {
    for (const {location, definitions} of TABLES) {
        for (const owner of Object.values(definitions)) {
            for (const point of owner.contributionPoints ?? []) {
                if (Object.hasOwn(OWN_ID_RULES, point.id)) continue;
                it(`${location} ${owner.id} 的 ${point.id}：第三方插件用别人的前缀被拒`, async () => {
                    // 拥有者的入口缺依赖会受阻，贡献点照样随插件定义登记，校验照样进行。
                    const application = createApplication(
                        {identity: {location, instanceId: `prefix-${point.id}`}, stopSignal: new AbortController().signal, emergency: () => undefined},
                        {plugins: [owner, intruder(point, location)], requiredPlugins: [], gates: []},
                    );
                    started.push(application);
                    await application.startup;
                    expect(application.plugins.contribution(point.id, "nbook.intruder")[0]?.validation).toMatchObject({status: "rejected", detail: expect.stringContaining(`插件 id ${INTRUDER}`)});
                });
            }
        }
    }

    it("豁免名单里的贡献点都还在", () => {
        const points = new Set(TABLES.flatMap(({definitions}) => Object.values(definitions).flatMap((owner) => (owner.contributionPoints ?? []).map((point) => point.id))));
        expect(Object.keys(OWN_ID_RULES).filter((point) => !points.has(point))).toEqual([]);
    });
});
