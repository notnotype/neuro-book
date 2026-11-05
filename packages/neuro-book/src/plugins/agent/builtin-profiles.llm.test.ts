/**
 * 内置 Profile 接真实模型（docs/specs/agent/builtin-profiles.md 的验收 5）：主创按要求改一个文件，之后后台用 tiny 角色生成标题和说明。
 * 判据是文件的最终内容与标题、说明写下了，不看措辞。只在 `NBOOK_LLM_TESTS=1` 时运行（docs/testing/README.md 的“真实模型”）。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {splitReference} from "nbook/plugins/models/shared/rules";

import {MAIN_PROFILE} from "./shared/contracts";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

const config = llmTestConfig();
let root = "";
let world: AgentWorld | null = null;

afterAll(async () => {
    await world?.close();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

describe.skipIf(config === null)("内置 Profile 接真实模型", () => {
    test("主创改一个文件；标题和说明在后台写下", async () => {
        const {provider, model} = splitReference(config!.model)!;
        root = await createTestTmpRoot("neuro-book-agent-llm", "builtin-profiles");
        world = await agentWorld(join(root, "world"), {
            env: {[config!.apiKeyEnv]: config!.apiKey},
            userSettings: {
                "nbook.models/providers": [{id: provider, kind: "catalog", name: provider, ...(config!.baseUrl === null ? {} : {baseUrl: config!.baseUrl}), apiKeyEnv: config!.apiKeyEnv, auth: "default", models: [{id: model, enabled: true}]}],
                "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" || id === "tiny" ? config!.model : null}))},
                "nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}},
            },
        });
        const created = await world.service.create({profile: MAIN_PROFILE});
        if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
        const session = created.value;
        const home = join(world.stateRoot, "agent", "sessions", session.id, "home");
        await mkdir(home, {recursive: true});
        await writeFile(join(home, "第一章.md"), "林舟走进雨里。\n他没有回头。\n雨越下越大。\n");

        const sent = await session.send({commandId: "llm-main", input: {text: "把 session://第一章.md 的第二行改成“他回头看了一眼。”，其余不动。"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
        const runId = sent.value.runId;
        const result = await waitUntil("运行结束", async () => {
            world!.settings.clock.advance(100);
            return session.runResult({runId});
        }, {timeoutMs: 240_000, intervalMs: 100});
        expect(result).toMatchObject({reason: "completed"});
        expect(await readFile(join(home, "第一章.md"), "utf8")).toBe("林舟走进雨里。\n他回头看了一眼。\n雨越下越大。\n");

        const meta = await waitUntil("标题和说明写下", async () => {
            world!.settings.clock.advance(100);
            const snapshot = await session.snapshot();
            return snapshot.description === null ? null : {title: snapshot.title, description: snapshot.description};
        }, {timeoutMs: 120_000, intervalMs: 100});
        console.log(JSON.stringify(meta));
        expect(meta.title?.length).toBeGreaterThan(0);
        expect(meta.description.length).toBeGreaterThan(0);
    }, 400_000);
});
