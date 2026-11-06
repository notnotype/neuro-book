/**
 * 对话宿主接真实模型（docs/specs/agent/conversation.md 验收 7）：主创改一个文件，经审批。判据是向导出现过、预览算出来了、批准之后文件的内容对，不看措辞。
 * 只在 `NBOOK_LLM_TESTS=1` 时运行（docs/testing/README.md 的“真实模型”）。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {PendingApprovalView} from "@notnotype/nb-agent-ui";

import {splitReference} from "nbook/plugins/models/shared/rules";

import {MAIN_PROFILE} from "./shared/contracts";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";
import {createSessionHost} from "./web/session-host";

const config = llmTestConfig();
let root = "";
let world: AgentWorld | null = null;

afterAll(async () => {
    await world?.close();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

describe.skipIf(config === null)("对话宿主接真实模型", () => {
    test("主创改一个文件，经审批", async () => {
        const {provider, model} = splitReference(config!.model)!;
        root = await createTestTmpRoot("neuro-book-agent-llm", "conversation");
        world = await agentWorld(join(root, "world"), {
            env: {[config!.apiKeyEnv]: config!.apiKey},
            userSettings: {
                "nbook.models/providers": [{id: provider, kind: "catalog", name: provider, ...(config!.baseUrl === null ? {} : {baseUrl: config!.baseUrl}), apiKeyEnv: config!.apiKeyEnv, auth: "default", models: [{id: model, enabled: true}]}],
                "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" || id === "tiny" ? config!.model : null}))},
                "nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "ask"}},
            },
        });
        const {client} = await world.window("llm");
        const host = createSessionHost({
            remote: client,
            project: null,
            now: () => world!.settings.clock.now(),
            schedule: (run, delay) => world!.settings.clock.schedule(run, delay),
            text: {t: (value: unknown) => String(value)} as never,
            newId: () => crypto.randomUUID(),
            recent: {read: async () => null, write: () => undefined},
            warnCost: () => 0,
            models: () => [],
            roles: () => null,
            drafts: {read: async () => null, write: () => undefined},
            profiles: () => [],
            copy: () => undefined,
            openSettings: () => undefined,
            openAddress: () => undefined,
            openLink: () => undefined,
            report: (code, message) => {
                throw new Error(`${code}: ${message}`);
            },
        });
        const id = await host.create(MAIN_PROFILE);
        const home = join(world.stateRoot, "agent", "sessions", id!, "home");
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "第一章.md"), "林舟走进雨里。\n他没有回头。\n雨越下越大。\n");

        host.act({type: "composer.submit", text: "把 session://第一章.md 的第二行改成“他回头看了一眼。”，其余不动。", delivery: "prompt"});
        let previewed = false;
        await waitUntil("运行结束", async () => {
            world!.settings.clock.advance(100);
            const ctx = host.ctx.value;
            for (const item of ctx.pendingInputs.filter((pending): pending is PendingApprovalView => pending.kind === "approval")) {
                if (item.preview.state === "loading") return false;
                if (item.preview.state === "ready" && item.preview.files.some((file) => file.kind === "diff" && file.after.includes("他回头看了一眼。"))) previewed = true;
                host.act({type: "input.submit", batchKey: item.id, resolutions: {kind: "approval", decision: "allow"}});
            }
            return ctx.run.status === "idle" && ctx.messages.some((message) => message.kind === "assistant" && message.status === "done" && message.toolCalls.length === 0);
        }, {timeoutMs: 240_000, intervalMs: 200});
        expect(previewed).toBe(true);
        expect(await readFile(join(home, "第一章.md"), "utf8")).toBe("林舟走进雨里。\n他回头看了一眼。\n雨越下越大。\n");
        expect(host.ctx.value.usage.totalTokens).toBeGreaterThan(0);
        host.dispose();
    }, 400_000);
});
