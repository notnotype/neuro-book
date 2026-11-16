/**
 * 插件带来的 Skill（docs/specs/agent/skills.md 输出 30–34 与场景 9）：真实的构建预设（`nbooke build`）打包一个带 Skill 的作者项目，
 * 经插件管理装进状态根、启动准备登记，第三方插件的定义交给场地，平台的插件包查询作为宿主能力挂上，与服务端宿主同一套。
 * 模型是本机的 OpenAI 兼容端点。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {serverHostModules} from "nbook/backend/plugin-host-modules";
import {createPluginInventory} from "nbook/plugin-platform/backend/inventory";
import type {InstalledPlugin} from "nbook/plugin-platform/backend/installed";
import {thirdPartyDefinitionsAt} from "nbook/plugin-platform/backend/loader";
import {createPluginPackages, pluginPackagesKey} from "nbook/plugin-platform/backend/packages";
import {installedPlugins, NO_INSTALLED_PLUGINS, prepareInstalledPlugins} from "nbook/plugin-platform/backend/startup";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";

import {buildPlugin} from "../../../plugin-sdk/build";
import {IN_REPO_BUILD} from "../../../plugin-sdk/build-examples";
import {linkAuthorModules} from "../../../plugin-sdk/testing/author";

import {MAIN_PROFILE} from "./shared/contracts";
import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint, Scripted} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let tmp = "";
let counter = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-agent", "plugin-skills");
    endpoint = fakeEndpoint();
});
afterEach(async () => {
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop();
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function writeAll(root: string, files: Readonly<Record<string, string>>): Promise<void> {
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), {recursive: true});
        await writeFile(join(root, path), text);
    }
}

/**
 * 写一个只带 Skill 的作者项目并用构建预设打包：Skill `<skill>` 的脚本用到作者目录里的一个 npm 包，打包后不再要它。交回输出目录。
 */
async function builtSkillPlugin(name: string, skill: string, displayName?: string): Promise<string> {
    const root = join(tmp, "authors", name);
    await linkAuthorModules(root);
    await writeAll(root, {
        "package.json": JSON.stringify({publisher: "acme", name, version: "1.0.0", type: "module", ...(displayName === undefined ? {} : {displayName})}),
        "plugin.ts": `export const descriptor = {id: "acme.${name}", version: "1.0.0", locations: [], contributions: [{capability: "agent.skills", id: "acme.${name}.skills", declaration: {directory: "skills"}}]};\n`,
        "node_modules/fake-dep/package.json": JSON.stringify({name: "fake-dep", version: "1.0.0", main: "index.js"}),
        "node_modules/fake-dep/index.js": `module.exports = () => "${name} dep-ok";\n`,
        [`skills/${skill}/SKILL.md`]: `---\nname: ${skill}\ndescription: ${skill} 的说明\n---\n\n${skill} 的正文：运行 scripts/run.ts。\n`,
        [`skills/${skill}/scripts/run.ts`]: "import dep from \"fake-dep\";\nconsole.log(dep());\n",
        [`skills/${skill}/package.json`]: JSON.stringify({dependencies: {"fake-dep": "1.0.0"}}),
    });
    const out = join(root, "dist");
    await buildPlugin({root, outDir: out, ...IN_REPO_BUILD});
    return out;
}

/** 装进状态根并做一次启动准备，交回本次启动登记的插件。 */
async function install(stateRoot: string, sources: ReadonlyArray<string>): Promise<InstalledPlugin[]> {
    const plugins = join(stateRoot, "plugins");
    const inventory = createPluginInventory({root: plugins, profile: NEUROBOOK_PROFILE, builtin: [], startup: NO_INSTALLED_PLUGINS, record: () => undefined});
    for (const source of sources) {
        const installed = await inventory.install(source);
        if (!installed.ok) throw new Error(JSON.stringify(installed));
    }
    return installedPlugins((await prepareInstalledPlugins({root: plugins, profile: NEUROBOOK_PROFILE, safeMode: false})).startup);
}

const definitionsOf = (installed: ReadonlyArray<InstalledPlugin>) => thirdPartyDefinitionsAt("server", installed, [], () => undefined, {profile: NEUROBOOK_PROFILE, hostModules: serverHostModules});

const textOf = (content: unknown): string => (typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => (typeof part === "object" && part !== null && "text" in part ? String(part.text) : "")).join("") : "");

async function turn(session: SessionApi, text: string, replies: readonly Scripted[]): Promise<number> {
    const sent = endpoint.requests.length;
    endpoint.script(...replies);
    const result = await session.send({commandId: crypto.randomUUID(), input: {text}});
    if (!result.ok || result.value.runId === null) throw new Error(JSON.stringify(result));
    await session.waitRun(result.value.runId);
    return sent;
}

describe("插件带来的 Skill", () => {
    test("场景 9：装好就在目录里、可用，按插件名排；$ 带上正文；shell 运行打包后的脚本（安装目录里没有 node_modules）", async () => {
        counter += 1;
        const base = join(tmp, `w${String(counter)}`);
        const [pdf, notes] = await Promise.all([builtSkillPlugin("pdftools", "pdf", "PDF 工具"), builtSkillPlugin("notetools", "notes")]);
        const installed = await install(join(base, "state"), [pdf, notes]);
        const w = await agentWorld(base, {
            plugins: definitionsOf(installed),
            userSettings: {...localModelSettings(endpoint.baseUrl), "nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}}},
            capabilities: [{id: "host.plugin-packages", key: pluginPackagesKey, create: () => createPluginPackages(installed, NEUROBOOK_PROFILE.format)}],
        });
        worlds.push(w);
        const {client} = await w.window("skills");
        const entries = async () => {
            const listed = await client.skills({});
            if (!listed.ok) throw new Error(listed.code);
            return listed.value;
        };
        const listed = await waitUntil("两个插件的 Skill 出现在目录里", async () => {
            const all = await entries();
            return all.length === 2 ? all : undefined;
        });
        // 没有显示名的插件按 id 排：acme.notetools 在 PDF 工具前面。
        expect(listed.map((entry) => [entry.id, entry.source, entry.plugin, entry.status, entry.problem])).toEqual([
            ["acme.notetools.notes", "plugin", {id: "acme.notetools", title: null}, "ready", undefined],
            ["acme.pdftools.pdf", "plugin", {id: "acme.pdftools", title: "PDF 工具"}, "ready", undefined],
        ]);
        expect(listed[1]?.location).toBe("skills://acme.pdftools.pdf/SKILL.md");

        const created = await w.service.create({profile: MAIN_PROFILE});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        const asked = await turn(session, "用 $pdf 处理第三章", ["好"]);
        const user = textOf(endpoint.requests[asked]!.messages.filter((message) => message.role === "user").at(-1)?.content);
        expect(user).toContain('<skill id="acme.pdftools.pdf" name="pdf" location="skills://acme.pdftools.pdf/SKILL.md">');
        expect(user).toContain("pdf 的正文：运行 scripts/run.ts。");

        // 模型经 shell 运行插件里打包好的脚本：依赖已经打进单文件。
        await turn(session, "运行它", [{tool: "shell", args: {command: "bun skills://acme.pdftools.pdf/scripts/run.ts"}}, "好"]);
        const shell = (await session.path()).filter((event) => event.type === "toolResult").map((event) => event.data as {readonly tool: string; readonly text?: string}).find((data) => data.tool === "nbook.agent.shell");
        expect(shell?.text).toContain("pdftools dep-ok");
    }, 60_000);

    test("没有插件包查询的宿主：插件的贡献不出 Skill，写诊断", async () => {
        counter += 1;
        const base = join(tmp, `w${String(counter)}`);
        const installed = await install(join(base, "state"), [await builtSkillPlugin("lonely", "solo")]);
        const w = await agentWorld(base, {plugins: definitionsOf(installed), userSettings: localModelSettings(endpoint.baseUrl)});
        worlds.push(w);
        const diagnostics = w.settings.diagnostics("hub");
        await waitUntil("写下诊断", () => diagnostics.query({}).records.find((record) => record.event === "agent.skills-root-unavailable"));
        const {client} = await w.window("skills");
        const listed = await client.skills({});
        expect(listed.ok && listed.value.map((entry) => entry.id)).toEqual([]);
    }, 60_000);
});
