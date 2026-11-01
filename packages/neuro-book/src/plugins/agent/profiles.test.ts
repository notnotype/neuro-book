/**
 * 用户级 Profile（docs/specs/agent/contributions.md 输出 9–12）：真实文件、真实的运行期打包与装载、真实服务端内核与模型服务，
 * 模型是本机的 OpenAI 兼容端点。测试名里的编号是 contributions.md 的输出条目。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {SessionApi} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {fakeEndpoint, localModelSettings} from "./testing/endpoint";
import type {FakeEndpoint} from "./testing/endpoint";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

let root = "";
let counter = 0;
let endpoint: FakeEndpoint;
const worlds: AgentWorld[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-agent", "user-profiles");
    endpoint = fakeEndpoint();
});
afterEach(async () => {
    endpoint.reset();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

let commands = 0;
const cid = () => `p-${String((commands += 1))}`;

const WRITER_SOURCE = `import {defineProfile} from "@notnotype/nb-plugin-sdk/agent";
import {note} from "./note";

export default defineProfile({id: "user.writer", version: "1", name: "我的写手", description: "测试用", system: <>{note}</>});
`;

/** 在状态根里写好用户的 Profile 文件，再起场地。 */
async function world(files: Readonly<Record<string, string>>): Promise<{readonly w: AgentWorld; readonly directory: string}> {
    counter += 1;
    const base = join(root, `w${String(counter)}`);
    const directory = join(base, "state", "user", "profiles");
    await mkdir(directory, {recursive: true});
    for (const [name, text] of Object.entries(files)) await writeFile(join(directory, name), text);
    const w = await agentWorld(base, {userSettings: localModelSettings(endpoint.baseUrl)});
    worlds.push(w);
    return {w, directory};
}

async function ask(session: SessionApi, text: string): Promise<string> {
    const sent = endpoint.requests.length;
    endpoint.script("好");
    const result = await session.send({commandId: cid(), input: {text}});
    if (!result.ok || result.value.runId === null) throw new Error(`send failed: ${JSON.stringify(result)}`);
    await session.waitRun(result.value.runId);
    return endpoint.requests[sent]!.system;
}

const reasons = async (session: SessionApi) => (await session.log({afterSeq: 0})).events.filter((event) => event.type === "profileChanged").map((event) => (event.data as {reason: string}).reason);

describe("用户级 Profile", () => {
    test("输出 9–11：打包装载用户写的 Profile（含 JSX 与本地导入）；改了导入的文件后重新打包，打开着的会话写 code-updated、下一次请求用新内容", async () => {
        const {w, directory} = await world({"writer.profile.tsx": WRITER_SOURCE, "note.ts": `export const note = "第一版说明";\n`});
        expect(w.service.profiles().filter((profile) => profile.source === "user")).toEqual([{key: "user.writer", name: "我的写手", description: "测试用", source: "user", status: "ok"}]);
        const created = await w.service.create({profile: "user.writer"});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        expect(await ask(session, "一")).toContain("第一版说明");

        await writeFile(join(directory, "note.ts"), `export const note = "第二版说明";\n`);
        await waitUntil("重新打包后写下 code-updated", async () => (await reasons(session)).includes("code-updated"));
        expect(await ask(session, "二")).toContain("第二版说明");

        // 编辑器式保存：先写临时文件再改名盖上去，只多一次版本变化。
        const temporary = join(directory, ".note.ts.swp");
        await writeFile(temporary, `export const note = "第三版说明";\n`);
        await rename(temporary, join(directory, "note.ts"));
        await waitUntil("第三版生效", async () => (await reasons(session)).filter((reason) => reason === "code-updated").length === 2);
        expect(await ask(session, "三")).toContain("第三版说明");
        expect((await reasons(session)).filter((reason) => reason === "code-updated")).toHaveLength(2);
    });

    test("输出 9、12：导入表外的包时目录标错误、会话继续用上一版；从来没成功过的不可用；删掉源文件后会话只读", async () => {
        const {w, directory} = await world({
            "writer.profile.tsx": WRITER_SOURCE,
            "note.ts": `export const note = "能用的说明";\n`,
            "broken.profile.tsx": `export default {id: "user.broken"};\n`,
        });
        expect(w.service.profiles().find((profile) => profile.key === "user.broken")).toMatchObject({status: "unavailable", reason: expect.stringContaining("profile-invalid-export")});
        const created = await w.service.create({profile: "user.writer"});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;

        await writeFile(join(directory, "writer.profile.tsx"), WRITER_SOURCE.replace(`import {note} from "./note";`, `import {note} from "./note";\nimport "left-pad";`));
        await waitUntil("打包失败标在目录里", () => w.service.profiles().find((profile) => profile.key === "user.writer")?.status === "error");
        expect(w.service.profiles().find((profile) => profile.key === "user.writer")?.reason).toMatch(/module-not-shared: left-pad/u);
        expect(await ask(session, "还能用吗")).toContain("能用的说明");

        await rm(join(directory, "writer.profile.tsx"));
        await waitUntil("删掉后会话只读", async () => (await session.snapshot()).readOnly?.code === "unknown-profile");
        expect(w.service.profiles().some((profile) => profile.key === "user.writer")).toBe(false);
    });

    test("输出 9：Profile 的 id 必须是 user.<文件名>", async () => {
        const {w} = await world({"mine.profile.tsx": `import {defineProfile} from "@notnotype/nb-plugin-sdk/agent";\nexport default defineProfile({id: "user.other", version: "1", name: "n", description: "d"});\n`});
        expect(w.service.profiles().find((profile) => profile.key === "user.mine")).toMatchObject({status: "unavailable", reason: expect.stringContaining("user.mine")});
    });

    test("输出 9、12：打包时没成功的，修好它导入的文件就重试；计算出来的导入以 module-not-shared 失败", async () => {
        const {w, directory} = await world({"writer.profile.tsx": WRITER_SOURCE, "note.ts": `export const note = ;\n`});
        expect(w.service.profiles().find((profile) => profile.key === "user.writer")?.status).toBe("unavailable");
        await writeFile(join(directory, "note.ts"), `export const note = "修好了";\n`);
        await waitUntil("修好依赖后重新打包成功", () => w.service.profiles().find((profile) => profile.key === "user.writer")?.status === "ok");

        await writeFile(join(directory, "dyn.profile.tsx"), `import {defineProfile} from "@notnotype/nb-plugin-sdk/agent";\nconst name = "left" + "-pad";\nawait import(name);\nexport default defineProfile({id: "user.dyn", version: "1", name: "d", description: "d"});\n`);
        await waitUntil("计算出来的导入被拒", () => w.service.profiles().find((profile) => profile.key === "user.dyn")?.reason?.includes("module-not-shared") === true);
    });

    test("输出 9：打包与求值期间用到的文件又变了，这次的结果作废、按新内容再打", async () => {
        const gate = globalThis as unknown as {__profileGate?: Promise<void>; __profileEntered?: () => void};
        const {w, directory} = await world({"writer.profile.tsx": WRITER_SOURCE, "note.ts": `export const note = "第一版说明";\n`});
        let release!: () => void;
        gate.__profileGate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const entered = new Promise<void>((resolve) => {
            gate.__profileEntered = resolve;
        });
        // 改成导入一个新文件、求值时停在门口；这时再改那个新文件。
        await writeFile(join(directory, "extra.ts"), `export const extra = "旧的附加";\n`);
        await writeFile(join(directory, "writer.profile.tsx"), WRITER_SOURCE.replace(`import {note} from "./note";`, `import {note as base} from "./note";\nimport {extra} from "./extra";\nconst gate = globalThis as unknown as {__profileGate?: Promise<void>; __profileEntered?: () => void};\ngate.__profileEntered?.();\nawait gate.__profileGate;\nconst note = base + extra;`));
        await entered;
        await writeFile(join(directory, "extra.ts"), `export const extra = "新的附加";\n`);
        release();
        const created = await w.service.create({profile: "user.writer"});
        if (!created.ok) throw new Error(created.code);
        await waitUntil("最后发布的是新内容", async () => (await ask(created.value, "看看")).includes("新的附加"));
        delete gate.__profileGate;
        delete gate.__profileEntered;
    });
});
