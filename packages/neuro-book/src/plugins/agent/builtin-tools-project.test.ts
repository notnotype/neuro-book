/**
 * 内置工具在 `project://` 上（docs/specs/agent/builtin-tools.md；验收的项目部分）：项目跑在真实子进程里，文件服务是真实的。这里没有
 * 整个 `nbook.agent`（真实项目与它的模型链路分别在别的测试里），工具的实现与资源视图是产品代码，由测试以 `nbook.agent` 的身份直接调用。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {readFile, realpath, rm, writeFile, mkdir} from "node:fs/promises";
import {join} from "node:path";

import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import type {ToolContext, ToolImplementation, ToolResult, ToolSessionContext, ToolCall, ToolEffect, ToolInfo} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {definitionAt} from "nbook/manifest";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {filesBackendPlugin} from "nbook/plugins/files/backend/plugin";
import {descriptor} from "nbook/plugins/files/plugin";
import {workspaceFilesKey} from "nbook/plugins/files/shared/contracts";
import type {WorkspaceFiles} from "nbook/plugins/files/shared/contracts";
import {killSpawnedProjects, projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";

import {builtinTools} from "./backend/builtin";
import {SessionEditStores} from "./backend/builtin/common";
import {createDialects} from "./backend/permissions/dialects";
import {createPermissionHook} from "./backend/permissions/hook";
import {sessionArtifacts, sessionResources} from "./backend/resources";

let tmp = "";
const harnesses: ProjectHarness[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-agent", "builtin-tools-project");
});
afterEach(async () => {
    try {
        for (const harness of harnesses.splice(0)) expect(await harness.parent.stop()).toMatchObject({status: "closed"});
    } finally {
        killSpawnedProjects();
    }
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function scene(): Promise<{readonly files: WorkspaceFiles; readonly book: string; run(tool: string, args: Readonly<Record<string, unknown>>): Promise<ToolResult>}> {
    const held: {files: WorkspaceFiles | null} = {files: null};
    const consumer: PluginDefinition = {id: "nbook.agent", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup"],
        dependencies: [{key: workspaceFilesKey}],
        activate: (context) => {
            held.files = context.services.require(workspaceFilesKey);
            return {};
        },
    })]};
    const silent = {error: () => undefined};
    const h = await projectHarness(tmp, {plugins: [
        createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
        definitionAt("server", descriptor, filesBackendPlugin),
        consumer,
    ]});
    harnesses.push(h);
    const files = held.files as WorkspaceFiles | null;
    if (files === null) throw new Error("测试插件没有激活");
    const context = {sessionId: "s1", profile: "p", project: "book"} as ToolSessionContext;
    const tools = builtinTools(new SessionEditStores(), createDialects(() => []), async () => ({ok: true}));
    const built = new Map<string, ToolImplementation>();
    return {
        files,
        book: join(h.root, "Book"),
        run: async (tool, args) => {
            let implementation = built.get(tool);
            if (implementation === undefined) {
                const services = {resources: sessionResources(files, context, tool), artifacts: sessionArtifacts(files, context)};
                implementation = await tools[tool]!.create(context, services);
                built.set(tool, implementation);
            }
            const call = {signal: new AbortController().signal, callId: "call-1", sessionId: "s1", initial: undefined, read: () => undefined} as unknown as ToolContext;
            return await implementation.execute(args, call) as ToolResult;
        },
    };
}

describe("项目规则文件（docs/specs/agent/permissions.md 输出 6）", () => {
    /** 真实文件服务与项目目录上问一次钩子。 */
    async function asker() {
        const {files, book} = await scene();
        const reported: string[] = [];
        const hook = createPermissionHook({
            files,
            userRules: () => [],
            dialects: createDialects(() => []),
            modeWriteAction: () => "deny",
            subjectsOf: async () => [],
            modeOf: () => "normal",
            report: (code) => reported.push(code),
        });
        const ask = async (tool: string, effect: ToolEffect) => hook(
            {id: "c", tool, args: {}} as ToolCall,
            {tool: {id: tool} as ToolInfo, effect, mode: "allow-writes", readOnly: false, remembered: [], rememberedRules: []},
            {signal: new AbortController().signal, sessionId: "s1", context: {sessionId: "s1", profile: "p", project: "book"}, model: (() => undefined) as never, read: () => undefined},
        );
        return {book, reported, ask};
    }
    const rules = async (book: string, text: string): Promise<void> => {
        await mkdir(join(book, ".nbook"), {recursive: true});
        await writeFile(join(book, ".nbook", "permissions.json"), text);
    };

    it("没有文件：按审批模式；改了下一次就生效", async () => {
        const {book, ask} = await asker();
        expect((await ask("t", "write")).verdict).toBe("allow");
        await rules(book, JSON.stringify([{tool: "t", action: "deny"}]));
        expect(await ask("t", "write")).toMatchObject({verdict: "deny", rejection: {code: "rule-denied"}});
        await rules(book, JSON.stringify([{tool: "t", action: "ask"}]));
        expect((await ask("t", "write")).verdict).toBe("ask");
    });

    it("放行规则不生效，写诊断", async () => {
        const {book, ask, reported} = await asker();
        await rules(book, JSON.stringify([{tool: "t", action: "allow"}]));
        expect((await ask("t", "exec")).verdict).toBe("ask");
        expect(reported).toContain("permission-allow-ignored");
    });

    it("文件坏了：写与执行都问，读不受影响，写诊断", async () => {
        const {book, ask, reported} = await asker();
        await rules(book, "这不是 JSON");
        expect((await ask("t", "write")).verdict).toBe("ask");
        expect((await ask("t", "read")).verdict).toBe("allow");
        expect(reported).toContain("permission-rules-invalid");
        await rules(book, JSON.stringify([{tool: "t", action: "没有这种"}]));
        expect((await ask("t", "write")).verdict).toBe("ask");
    });
});

describe("内置工具在 project:// 上", () => {
    it("读写改搜都用全局地址；.nbook 不露出；shell 的工作目录与 $NBOOK_PROJECT 是项目目录", async () => {
        const {book, run} = await scene();
        const realBook = await realpath(book);
        await writeFile(join(book, "a.md"), "一\n二\n");

        const read = await run("nbook.agent.read", {path: "project://a.md"});
        expect(read.text.split("\n")[0]).toMatch(/^\[projects:\/\/book\/a\.md#[0-9A-F]{4}\]$/u);
        expect(await run("nbook.agent.read", {path: "project://.nbook/project.json"})).toMatchObject({code: "protected-path"});
        const tag = /#([0-9A-F]{4})\]/u.exec(read.text)![1]!;
        expect(await run("nbook.agent.edit", {input: `[project://a.md#${tag}]\nPUT 2.=2:\n+贰\n`})).not.toMatchObject({status: "error"});
        expect(await readFile(join(book, "a.md"), "utf8")).toBe("一\n贰\n");
        expect(await run("nbook.agent.write", {path: "project://新/章.md", content: "贰\n"})).not.toMatchObject({status: "error"});
        expect(await readFile(join(book, "新/章.md"), "utf8")).toBe("贰\n");

        // `.nbook/project.json` 里有项目名：要是扫了又没过滤，这里会露出来。
        const grep = await run("nbook.agent.grep", {pattern: "贰|\"id\""});
        expect(grep.text).toContain("projects://book/a.md");
        expect(grep.text).toContain("projects://book/新/章.md");
        expect(grep.text).not.toContain(".nbook");
        const glob = await run("nbook.agent.glob", {pattern: "**/*"});
        expect(glob.text).toContain("projects://book/a.md");
        expect(glob.text).not.toContain(".nbook");

        const shell = await run("nbook.agent.shell", {command: 'pwd; echo "$NBOOK_PROJECT"; cat project://a.md; echo 写 > project://新文件.md'});
        expect(shell.text.split("\n").slice(0, 4)).toEqual([realBook, realBook, "一", "贰"]);
        expect(await readFile(join(book, "新文件.md"), "utf8")).toBe("写\n");
        expect(await run("nbook.agent.shell", {command: "cat project://.nbook/project.json"})).toMatchObject({code: "protected-path"});
    }, 30_000);
});
