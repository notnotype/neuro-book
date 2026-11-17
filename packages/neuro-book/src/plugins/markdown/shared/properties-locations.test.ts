/**
 * 属性声明的贡献点在两个位置都登记（docs/specs/workbench/markdown-editing.md 输出 59）：顶层声明在每个位置都要有拥有者，
 * 项目位置不使用它，但贡献方插件的顶层声明在那里也要被接受（合格的）或按声明形状拒绝（不合格的），不能成了“未知贡献点”。
 */

import {afterEach, describe, expect, it} from "bun:test";

import type {Application} from "@notnotype/nb-runtime/application";
import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createApplication} from "nbook/application";
import {projectPluginDefinitions} from "nbook/project/plugins";
import {browserPluginDefinitions} from "nbook/web/plugins";

const started: Application[] = [];
afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

const contributor: PluginDefinition = {
    id: "test.canon",
    contributions: [
        {capability: "markdown.properties", id: "test.canon.pov", declaration: {name: "视角", label: "叙述视角"}},
        {capability: "markdown.properties", id: "test.canon.bad", declaration: {name: "视角"}},
    ],
    entries: [],
};

describe("贡献点 markdown.properties 在两个位置的登记", () => {
    for (const [location, definitions] of [["browser", browserPluginDefinitions], ["project", projectPluginDefinitions]] as ReadonlyArray<readonly [RuntimeLocation, Readonly<Record<string, PluginDefinition>>]>) {
        it(`${location}：合格的顶层声明被接受，三项都没给的被拒绝（不是未知贡献点）`, async () => {
            const owner = definitions["nbook.markdown"];
            if (owner === undefined) throw new Error(`${location} 位置没有 nbook.markdown`);
            const application = createApplication(
                {identity: {location, instanceId: `properties-${location}`}, stopSignal: new AbortController().signal, emergency: () => undefined},
                {plugins: [owner, contributor], requiredPlugins: [], gates: []},
            );
            started.push(application);
            await application.startup;
            expect(application.plugins.contribution("markdown.properties", "test.canon.pov")[0]?.validation).toMatchObject({status: "accepted"});
            expect(application.plugins.contribution("markdown.properties", "test.canon.bad")[0]?.validation).toMatchObject({status: "rejected", reason: "invalid-declaration"});
        });
    }
});
