/**
 * Skill 目录经真实应用与窗口远程（docs/specs/agent/skills.md 输出 1、5）：插件启动时扫好目录，窗口先订阅 `skillsChanged`
 * 再取 `skills`。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let tmp = "";
let counter = 0;
const worlds: AgentWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-agent", "skills");
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("远程", () => {
    test("输出 1、5：启动时已有的 Skill 取得到；放进新的 Skill 后收到 skillsChanged，再取就有它", async () => {
        counter += 1;
        const base = join(tmp, `w${String(counter)}`);
        const write = async (name: string) => {
            const directory = join(base, "state", "user", "skills", name);
            await mkdir(directory, {recursive: true});
            await writeFile(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} 的说明\n---\n\n正文\n`);
        };
        await write("style-guide");
        const w = await agentWorld(base);
        worlds.push(w);
        const {client} = await w.window("skills");
        let events = 0;
        const subscription = await client.events.skillsChanged.subscribe({}, () => {
            events += 1;
        });
        if (!subscription.ok) throw new Error(subscription.code);
        const ids = async () => {
            const listed = await client.skills({});
            if (!listed.ok) throw new Error(listed.code);
            return listed.value.map((entry) => `${entry.id}:${entry.status}`);
        };
        expect(await ids()).toEqual(["user.style-guide:ready"]);

        await write("lore-check");
        // 目录的重扫按宿主时钟防抖，场地的时钟是手动的：等文件事件到的同时推时钟。
        await waitUntil("收到 skillsChanged", () => {
            w.settings.clock.advance(1_000);
            return events > 0 || undefined;
        }, {timeoutMs: 10_000});
        expect(await ids()).toEqual(["user.lore-check:ready", "user.style-guide:ready"]);
    }, 20_000);
});
