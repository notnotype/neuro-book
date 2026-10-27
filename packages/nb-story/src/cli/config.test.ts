/**
 * `nbstory config`（docs/specs/story/qa.md 输出 18 到 21，F1、F7）：跑真实的命令行进程；`test` 的请求经真实的 OMP
 * provider 发往本机的 OpenAI 兼容端点，用端点收到的正文核对推理档。
 *
 * 密钥都是测试里编的假值，只发往本机端点。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {chmod, mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {PassThrough} from "node:stream";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {startEndpoint, type Endpoint, type EndpointReply} from "../../testing/openai-endpoint";
import {CLI} from "../../testing/processes";
import {parseQaConfig} from "../qa/config";
import {configCatalog} from "../qa/harness-model";
import {confirmOverwrite, initInteractively} from "./config-init";

const catalog = configCatalog();

const KEY_ENV = "NBSTORY_CONFIG_TEST_CREDENTIAL";
const FAKE_KEY = "fake-credential-for-config-test-0042";

let root = "";
let counter = 0;
const endpoints: Endpoint[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("nb-story", "config-cmd");
});

afterAll(async () => {
    for (const endpoint of endpoints) endpoint.stop();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

function freshPath(): string {
    counter += 1;
    return join(root, `case-${counter}`, "config.json");
}

async function run(args: string[], env: Record<string, string | undefined> = {[KEY_ENV]: FAKE_KEY}): Promise<{code: number; stdout: string; stderr: string}> {
    const child = Bun.spawn(["bun", CLI, ...args], {stdout: "pipe", stderr: "pipe", env: {...process.env, ...env}});
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return {code, stdout, stderr};
}

const INIT_FLAGS = ["--base-url", "http://127.0.0.1:1/v1", "--model", "m1", "--api-key-env", KEY_ENV];

async function written(path: string): Promise<unknown> {
    return JSON.parse(await readFile(path, "utf8"));
}

/** `INIT_FLAGS` 写出的第 2 版：自定义服务商 custom 里的 m1。 */
function customConfig(models: string[] = ["m1"], extra: object = {}): object {
    return {providers: {custom: {api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", apiKeyEnv: KEY_ENV, models: models.map(id => ({id}))}}, models: models.map(id => `custom/${id}`), ...extra};
}

describe("init、show、set、unset", () => {
    test("选项给齐就直接写，目录不存在时建出来；show 说明密钥环境变量设没设置，不打印密钥", async () => {
        const path = freshPath();
        const init = await run(["config", "init", ...INIT_FLAGS, "--thinking", "xhigh", "--config", path]);
        expect(init.code).toBe(0);
        const first = customConfig(["m1"], {model: {use: "custom/m1", thinking: "xhigh"}}) as {providers: {custom: {models: object[]}}};
        first.providers.custom.models = [{id: "m1", reasoning: true}];
        expect(await written(path)).toEqual(first);

        const set = await run(["config", "show", "--config", path]);
        expect(set.stdout).toContain(`密钥环境变量 ${KEY_ENV}（已设置）`);
        expect(set.stdout).toContain("默认模型：custom/m1");
        expect(set.stdout).toContain("推理档：xhigh");
        expect(`${set.stdout}${set.stderr}`).not.toContain(FAKE_KEY);
        const unset = await run(["config", "show", "--config", path], {[KEY_ENV]: undefined});
        expect(unset.stdout).toContain("没有设置");

        const json = await run(["config", "show", "--config", path, "--json"]);
        expect(JSON.parse(json.stdout)).toEqual({
            ok: true,
            data: {
                path, config: await written(path),
                model: {use: "custom/m1", thinking: "xhigh"},
                providers: [{id: "custom", source: "custom", keyEnvs: [KEY_ENV], keySet: true, api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1"}],
                ingest: {source: "model", id: "m1", apiKeySet: true},
                recall: null,
            },
        });
    });

    test("用目录里的模型：只给 服务商/模型名；推理档往下夹；目录里没有的模型是用法错误", async () => {
        const path = freshPath();
        const init = await run(["config", "init", "--model", "deepseek/deepseek-flash", "--thinking", "medium", "--config", path]);
        expect(init.code).toBe(0);
        expect(await written(path)).toEqual({models: ["deepseek/deepseek-flash"], model: {use: "deepseek/deepseek-flash", thinking: "medium"}});
        const show = await run(["config", "show", "--config", path], {DEEPSEEK_API_KEY: undefined});
        expect(show.stdout).toContain("推理档：medium（模型不支持这一档，实际发 low）");
        expect(show.stdout).toContain("deepseek（OMP 目录）：密钥环境变量 DEEPSEEK_API_KEY");
        expect(show.stdout).toContain("抽取模型：抽取要单独写模型");
        expect((await run(["config", "init", "--model", "deepseek/not-a-model", "--config", freshPath()])).code).toBe(2);
    });

    test("缺必填项又不在终端：用法错误，退出码 2，不写文件，不挂起等输入", async () => {
        const path = freshPath();
        const result = await run(["config", "init", "--model", "m1", "--config", path]);
        expect(result.code).toBe(2);
        expect(result.stderr).toContain("--base-url");
        expect(result.stderr).toContain("--api-key-env");
        expect((await run(["config", "init", "--config", path])).stderr).toContain("缺少 --model");
        expect(await readdir(join(path, "..")).catch(() => [])).toEqual([]);
    });

    test("已有配置：不加 --force 不动；加了只改给出的字段，其余保留", async () => {
        const path = freshPath();
        await run(["config", "init", ...INIT_FLAGS, "--config", path]);
        await run(["config", "set", "qa.maxChapters", "7", "--config", path]);
        const before = await readFile(path, "utf8");
        const refused = await run(["config", "init", ...INIT_FLAGS, "--model", "m2", "--config", path]);
        expect(refused.code).toBe(2);
        expect(refused.stderr).toContain("--force");
        expect(await readFile(path, "utf8")).toBe(before);
        // 只给模型名：沿用自定义服务商的地址与密钥变量，m2 加进候选并设为默认。
        const forced = await run(["config", "init", "--model", "m2", "--thinking", "high", "--force", "--config", path]);
        expect(forced.code).toBe(0);
        const expected = customConfig(["m1", "m2"], {model: {use: "custom/m2", thinking: "high"}, qa: {maxChapters: 7}}) as {providers: {custom: {models: object[]}}};
        expected.providers.custom.models = [{id: "m1"}, {id: "m2", reasoning: true}];
        expect(await written(path)).toEqual(expected);
    });

    test("没有配置时 show、set、unset 报 qa_unconfigured（退出码 1）并指向 init", async () => {
        const path = freshPath();
        for (const args of [["show"], ["set", "model.use", "custom/x"], ["unset", "model.thinking"]]) {
            const result = await run(["config", ...args, "--config", path]);
            expect(result.code).toBe(1);
            expect(result.stderr).toContain("qa_unconfigured");
            expect(result.stderr).toContain("config init");
        }
    });

    test("set 改一个字段、unset 去掉可选字段；字段不认识、值写不对是用法错误（2），越界是配置错误（1）且文件不变", async () => {
        const path = freshPath();
        await run(["config", "init", ...INIT_FLAGS, "--config", path]);
        expect((await run(["config", "set", "model.thinking", "xhigh", "--config", path])).code).toBe(0);
        expect(await written(path)).toMatchObject({model: {thinking: "xhigh"}});
        expect((await run(["config", "unset", "model.thinking", "--config", path])).code).toBe(0);
        expect((await written(path) as {model: object}).model).not.toHaveProperty("thinking");
        expect((await run(["config", "set", "providers.custom.api", "openai-responses", "--config", path])).code).toBe(0);
        const responses = (await run(["config", "show", "--config", path])).stdout;
        expect(responses).toContain("自定义，openai-responses");
        expect(responses).toContain("Responses 接口，没有推理档就不要思考摘要");

        const before = await readFile(path, "utf8");
        // 都不写盘，并行跑：每个都是一个命令行进程。`toString` 是普通对象从原型继承来的名字，也不是字段。
        const wrong = [
            ["set", "model.nope", "1"], ["unset", "toString"], ["set", "qa.maxChapters", "多"], ["set", "model.thinking", "ultra"], ["set", "providers.custom.api", "grpc"],
            ["unset", "model.use"], ["set", "model.use"], ["bogus"], [],
            // 字段之间的约束不成立、第 1 版的路径。
            ["set", "model.use", "custom/other"], ["set", "providers.deepseek", '{"api":"openai-completions","baseUrl":"http://x/v1","apiKeyEnv":"X_ENV","models":[]}'], ["set", "model.baseUrl", "http://x/v1"],
        ];
        const results = await Promise.all(wrong.map(args => run(["config", ...args, "--config", path])));
        expect(results.map(result => result.code)).toEqual(wrong.map(() => 2));
        expect(results.at(-1)!.stderr).toContain("providers.custom.baseUrl");
        const outOfRange = await run(["config", "set", "qa.maxChapters", "21", "--config", path, "--json"]);
        expect(outOfRange.code).toBe(1);
        expect((JSON.parse(outOfRange.stdout) as {error: {code: string}}).error.code).toBe("qa_unconfigured");
        expect(await readFile(path, "utf8")).toBe(before);
    }, 30_000);

    test("密钥环境变量名写成了别的（像是贴了密钥）：init 与 set 都是用法错误（2），不写盘，输出里没有原文", async () => {
        const pasted = "sk-pasted-credential-0042";
        const path = freshPath();
        const init = await run(["config", "init", "--base-url", "http://127.0.0.1:1/v1", "--model", "m1", "--api-key-env", pasted, "--config", path]);
        expect(init.code).toBe(2);
        expect(await readdir(join(path, "..")).catch(() => [])).toEqual([]);

        await run(["config", "init", ...INIT_FLAGS, "--config", path]);
        const before = await readFile(path, "utf8");
        const set = await run(["config", "set", "providers.custom.apiKeyEnv", pasted, "--config", path, "--json"]);
        expect(set.code).toBe(2);
        expect(await readFile(path, "utf8")).toBe(before);
        for (const result of [init, set]) expect(`${result.stdout}${result.stderr}`).not.toContain(pasted);
    });

    test("写不进去（目录位置是个文件、目录进不去）：qa_config_write_failed，退出码 1，--json 时照样输出 JSON", async () => {
        const blocker = join(root, "blocker");
        await writeFile(blocker, "x");
        const result = await run(["config", "init", ...INIT_FLAGS, "--config", join(blocker, "config.json")]);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain("qa_config_write_failed");

        // 只读且不可进入：写临时文件失败，清理它也会失败，报的仍是写失败。
        const locked = join(root, "locked");
        await mkdir(locked);
        await chmod(locked, 0o444);
        try {
            const json = await run(["config", "init", ...INIT_FLAGS, "--config", join(locked, "config.json"), "--json"]);
            expect(json.code).toBe(1);
            expect(JSON.parse(json.stdout)).toEqual({ok: false, error: expect.objectContaining({code: "qa_config_write_failed"})});
        } finally {
            await chmod(locked, 0o755);
        }
        expect(await readdir(locked)).toEqual([]);
    });

    test("config set ingest.model 可以用 --model、--base-url、--api-key-env、--max-tokens 分项写", async () => {
        const path = freshPath();
        expect((await run(["config", "init", ...INIT_FLAGS, "--config", path])).code).toBe(0);
        const set = await run(["config", "set", "ingest.model", "--model", "gpt-6-luna", "--base-url", "https://www.jiji.cc/v1", "--api-key-env", KEY_ENV, "--max-tokens", "16000", "--config", path]);
        expect(set.code).toBe(0);
        expect(set.stdout).toContain("已改 ingest.model");
        expect(await written(path)).toMatchObject({ingest: {model: {baseUrl: "https://www.jiji.cc/v1", id: "gpt-6-luna", apiKeyEnv: KEY_ENV, maxTokens: 16000}}});

        const missing = await run(["config", "set", "ingest.model", "--model", "m", "--config", path]);
        expect(missing.code).toBe(2);
        expect(missing.stderr).toContain("缺少 --base-url、--api-key-env");
    });
});

async function configWithEndpoint(replies: EndpointReply[], thinking?: string): Promise<{path: string; endpoint: Endpoint}> {
    const endpoint = startEndpoint(replies);
    endpoints.push(endpoint);
    const path = freshPath();
    await mkdir(join(path, ".."), {recursive: true});
    await writeFile(path, JSON.stringify({model: {baseUrl: endpoint.url, id: "test-model", apiKeyEnv: KEY_ENV, ...(thinking === undefined ? {} : {thinking})}}));
    return {path, endpoint};
}

describe("config test", () => {
    test("模型回话即通过；请求带配置里的推理档和认证；模型回话里回显了密钥，输出里也没有", async () => {
        const {path, endpoint} = await configWithEndpoint([{kind: "text", text: `好，${FAKE_KEY}`}], "xhigh");
        const result = await run(["config", "test", "--config", path]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain("通过：custom/test-model");
        expect(result.stdout).toContain("推理档：xhigh");
        expect(endpoint.bodies.map(body => body.reasoning_effort)).toEqual(["xhigh"]);
        expect(endpoint.authorizations).toEqual([`Bearer ${FAKE_KEY}`]);
        expect(`${result.stdout}${result.stderr}`).not.toContain(FAKE_KEY);
    });

    test("配置里没写推理档：请求里没有，输出说由服务端的默认档决定", async () => {
        const {path, endpoint} = await configWithEndpoint([{kind: "text", text: "好"}]);
        const result = await run(["config", "test", "--config", path]);
        expect(result.code).toBe(0);
        expect(endpoint.bodies[0]).not.toHaveProperty("reasoning_effort");
        expect(result.stdout).toContain("由服务端的默认档决定");
    });

    test("认证被拒：退出码 4，错误归类 auth，错误正文里回显的密钥也不出现在输出里", async () => {
        const {path} = await configWithEndpoint([{kind: "status", status: 401, echoKey: true}]);
        const result = await run(["config", "test", "--config", path, "--json"]);
        expect(result.code).toBe(4);
        expect(JSON.parse(result.stdout)).toEqual({ok: false, error: expect.objectContaining({code: "model_failed", kind: "auth"})});
        expect(`${result.stdout}${result.stderr}`).not.toContain(FAKE_KEY);
    });

    test("密钥环境变量没设置：退出码 4，不向端点发请求", async () => {
        const {path, endpoint} = await configWithEndpoint([{kind: "text", text: "好"}]);
        const result = await run(["config", "test", "--config", path], {[KEY_ENV]: undefined});
        expect(result.code).toBe(4);
        expect(result.stderr).toContain(KEY_ENV);
        expect(endpoint.bodies).toEqual([]);
    });
});

describe("init 的交互", () => {
    /**
     * 把按键一段一段喂给提示：clack 一次只读一个提示的输入，等它画出来再喂。`close` 结束输入输出：断言失败时还在
     * 等输入的提示不会留到后面的用例里。
     */
    function terminal() {
        const input = Object.assign(new PassThrough(), {isTTY: true, setRawMode: () => undefined}) as unknown as PassThrough & NodeJS.ReadStream;
        const output = new PassThrough();
        let screen = "";
        output.on("data", chunk => (screen += String(chunk)));
        const type = async (keys: string, expectScreen: string): Promise<void> => {
            await waitUntil(`屏幕上出现“${expectScreen}”`, () => screen.includes(expectScreen), {timeoutMs: 4000});
            input.write(keys);
        };
        const close = (): void => {
            input.destroy();
            output.destroy();
        };
        return {streams: {input, output}, type, close};
    }

    test("自定义地址：依次问地址、模型名、密钥环境变量名、推理档，返回新配置", async () => {
        const term = terminal();
        try {
            const result = initInteractively({path: "/x/config.json", confirmOverwrite: false, existing: null, flags: {}, catalog, streams: term.streams});
            // 没有配置时默认选自定义地址。
            await term.type("\r", "用哪里的模型");
            await term.type("http://h/v1\r", "OpenAI 兼容服务的地址");
            await term.type("m9\r", "模型名");
            await term.type("MY_KEY\r", "存密钥的环境变量名");
            await term.type("\u001b[B\u001b[B\u001b[B\u001b[B\u001b[B\r", "推理档");
            expect(await result).toEqual({providers: {custom: {api: "openai-completions", baseUrl: "http://h/v1", apiKeyEnv: "MY_KEY", models: [{id: "m9", reasoning: true}]}}, models: ["custom/m9"], model: {use: "custom/m9", thinking: "xhigh"}});
        } finally {
            term.close();
        }
    });

    test("目录里的模型：问 服务商/模型名，目录里没有的不收", async () => {
        const term = terminal();
        try {
            const result = initInteractively({path: "/x/config.json", confirmOverwrite: false, existing: null, flags: {}, catalog, streams: term.streams});
            await term.type("\u001b[A\r", "用哪里的模型");
            await term.type("deepseek/nope\r", "服务商/模型名");
            await term.type(`${"\u007f".repeat(4)}deepseek-flash\r`, "里没有模型 nope");
            await term.type("\r", "推理档");
            expect(await result).toEqual({models: ["deepseek/deepseek-flash"], model: {use: "deepseek/deepseek-flash"}});
        } finally {
            term.close();
        }
    });

    test("贴进来的是密钥而不是变量名：拒绝并说明，改填变量名后通过", async () => {
        const term = terminal();
        try {
            const pasted = "sk-abc-123";
            const result = initInteractively({path: "/x/config.json", confirmOverwrite: false, existing: null, flags: {baseUrl: "http://h/v1", model: "m"}, catalog, streams: term.streams});
            await term.type(`${pasted}\r`, "存密钥的环境变量名");
            await term.type(`${"\u007f".repeat(pasted.length)}MY_KEY\r`, "不是密钥本身");
            await term.type("\r", "推理档");
            expect(await result).toEqual({providers: {custom: {api: "openai-completions", baseUrl: "http://h/v1", apiKeyEnv: "MY_KEY", models: [{id: "m"}]}}, models: ["custom/m"], model: {use: "custom/m"}});
        } finally {
            term.close();
        }
    });

    test("中途取消返回 null，调用方不写盘", async () => {
        const term = terminal();
        try {
            const result = initInteractively({path: "/x/config.json", confirmOverwrite: false, existing: null, flags: {}, catalog, streams: term.streams});
            await term.type("\u0003", "用哪里的模型");
            expect(await result).toBeNull();
        } finally {
            term.close();
        }
    });

    test("已有配置：默认不覆盖，选否即取消；选是后保留没问到的字段，推理档选“不写”会去掉原来的", async () => {
        const existing = parseQaConfig({model: {baseUrl: "http://old/v1", id: "old", apiKeyEnv: "OLD_KEY", thinking: "high"}, qa: {maxChapters: 5}}, "");
        const refused = terminal();
        try {
            const first = initInteractively({path: "/x/config.json", confirmOverwrite: true, existing, flags: {}, catalog, streams: refused.streams});
            await refused.type("\r", "覆盖");
            expect(await first).toBeNull();
        } finally {
            refused.close();
        }

        const term = terminal();
        try {
            const result = initInteractively({path: "/x/config.json", confirmOverwrite: true, existing, flags: {}, catalog, streams: term.streams});
            await term.type("y", "覆盖");
            // 已有的默认模型在自定义服务商里：默认选自定义地址，各项默认是原来的值。
            await term.type("\r", "用哪里的模型");
            await term.type("\r", "OpenAI 兼容服务的地址");
            await term.type("\r", "模型名");
            await term.type("\r", "存密钥的环境变量名");
            await term.type("\u001b[A\u001b[A\u001b[A\u001b[A\r", "推理档");
            expect(await result).toEqual({providers: {custom: {api: "openai-completions", baseUrl: "http://old/v1", apiKeyEnv: "OLD_KEY", models: [{id: "old", reasoning: true}]}}, models: ["custom/old"], model: {use: "custom/old"}, qa: {maxChapters: 5}});
        } finally {
            term.close();
        }
    });

    test("字段都在选项里给了：只确认覆盖，默认不覆盖", async () => {
        for (const [keys, expected] of [["\r", false], ["y", true]] as const) {
            const term = terminal();
            try {
                const answer = confirmOverwrite("/x/config.json", term.streams);
                await term.type(keys, "覆盖");
                expect(await answer).toBe(expected);
            } finally {
                term.close();
            }
        }
    });
});
