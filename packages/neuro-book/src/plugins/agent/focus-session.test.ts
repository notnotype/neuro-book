/**
 * `nbook.agent.focus-session` 如实交回失败（docs/specs/agent/conversation.md 输出 53）：真实的 Agent 浏览器入口、命令表、工作台与
 * 远程，文件存储。只走打开之前的判断与揭示，不挂工作台页面（布局没就绪时揭示视图的命令本身就失败，正好用来看失败一路交回）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {Text} from "@notnotype/nb-ui/text";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {definitionAt, productPlugins} from "nbook/manifest";
import {commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandResult, CommandService} from "nbook/plugins/commands/shared/contracts";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {editorBrowserPlugin} from "nbook/plugins/editor/web/plugin";
import {filesBrowserPlugin} from "nbook/plugins/files/web/plugin";
import {markdownBrowserPlugin} from "nbook/plugins/markdown/web/plugin";
import {projectsBrowserPlugin} from "nbook/plugins/projects/web/plugin";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";
import {storageBrowserPlugin} from "nbook/plugins/storage/web/plugin";
import {workbenchBrowserPlugin} from "nbook/plugins/workbench/web/plugin";

import {MAIN_PROFILE} from "./shared/contracts";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";
import {agentBrowserPlugin, FOCUS_SESSION_COMMAND} from "./web/plugin";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "focus-session");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const descriptors = new Map(productPlugins.map((plugin) => [plugin.id, plugin]));
const at = (location: "server" | "browser", plugin: PluginDefinition): PluginDefinition => definitionAt(location, descriptors.get(plugin.id)!, plugin);

async function world(): Promise<AgentWorld> {
    return agentWorld(root, {withoutModels: true, plugins: [at("server", storageBackendPlugin)]});
}

/** 起一个装了 Agent 浏览器入口的窗口，交回它的命令服务。 */
async function windowCommands(w: AgentWorld, id: string): Promise<CommandService> {
    let commands: CommandService | null = null;
    const helper: PluginDefinition = {id: `test.focus-${id}`, entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: commandServiceKey}], activate: (context) => {
        commands = context.services.require(commandServiceKey);
        return {};
    }})]};
    const plugins = [statePlugin, storageBrowserPlugin, filesBrowserPlugin, commandsPlugin, workbenchBrowserPlugin, editorBrowserPlugin, projectsBrowserPlugin, markdownBrowserPlugin, agentBrowserPlugin].map((plugin) => at("browser", plugin));
    await w.settings.window(id, [...plugins, helper], {bound: false});
    if (commands === null) throw new Error("the helper did not activate");
    return commands;
}

const reasonCode = (result: CommandResult<unknown>): unknown => (result.ok ? null : ((result.reason as Exclude<Text, string>).params as {code?: unknown} | undefined)?.code);

describe("focus-session 的失败（conversation.md 输出 53）", () => {
    test("会话不存在、会话头损坏、要迁移：打开之前交回失败；先读到过会话头的再坏了也照样失败；视图揭示不了时交回那次失败", async () => {
        // 先建一个会话、停掉服务，下面在磁盘上改它的日志：服务端没有打开它，会话头只能从文件读。
        const first = await world();
        const created = await first.service.create({profile: MAIN_PROFILE});
        if (!created.ok) throw new Error(created.code);
        const id = created.value.id;
        await first.close();
        const log = join(root, "state", "agent", "sessions", id, "session.jsonl");
        const original = await readFile(log, "utf8");
        const [headerLine] = original.split("\n");

        const w = await world();
        try {
            const commands = await windowCommands(w, "a");
            const missing = await commands.execute(FOCUS_SESSION_COMMAND, {sessionId: "no-such-session"});
            expect(missing.ok).toBe(false);
            expect(reasonCode(missing)).toBe("session-not-found");

            // 会话头读得到：接着去揭示视图，工作台的布局还没就绪，揭示的命令失败，这次失败交回来，不交回成功。
            const unrevealed = await commands.execute(FOCUS_SESSION_COMMAND, {sessionId: id});
            expect(unrevealed.ok).toBe(false);
            expect(reasonCode(unrevealed)).not.toBe("log-corrupt");

            // 上一次读到的会话头已经记进归属表；之后会话头坏了，仍按会话头此刻的样子交回失败。
            await writeFile(log, `not-json\n${original.slice(headerLine!.length + 1)}`);
            const corrupt = await commands.execute(FOCUS_SESSION_COMMAND, {sessionId: id});
            expect(reasonCode(corrupt)).toBe("log-corrupt");

            const tooNew = {...(JSON.parse(headerLine!) as Record<string, unknown>), format: 99};
            await writeFile(log, `${JSON.stringify(tooNew)}\n${original.slice(headerLine!.length + 1)}`);
            const migration = await commands.execute(FOCUS_SESSION_COMMAND, {sessionId: id});
            expect(reasonCode(migration)).toBe("needs-migration");
        } finally {
            await writeFile(log, original);
            await w.close();
        }
    });
});
