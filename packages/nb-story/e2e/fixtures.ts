/**
 * e2e 的场地：临时书库里导入样例书，起真实的 `nbstory serve`，用打印的登录链接登录。
 * 子进程用 Node 的 child_process 起（e2e 由 Node 运行），命令本身仍是 `bun src/cli.ts`。
 */

import {spawn, type ChildProcess} from "node:child_process";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {expect, type BrowserContext, type Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const PACKAGE = join(import.meta.dirname, "..");
const CLI = join(PACKAGE, "src", "cli.ts");

export interface StoryServer {
    library: string;
    login: string;
    base: string;
    stop(signal?: NodeJS.Signals): Promise<number | null>;
}

export async function makeLibrary(name: string): Promise<{root: string; library: string; cleanup(): Promise<void>}> {
    const root = await createTestTmpRoot(`nb-story-e2e-${name}`, `nb-story e2e ${name}`);
    const library = join(root, "library");
    const file = join(root, "sample.json");
    await writeFile(file, gunzipSync(await readFile(join(PACKAGE, "tests", "fixtures", "sample-100ch.json.gz"))));
    const result = await runCli(["import", file, "--title", "转生反派萝莉，找茬魔法少女", "--id", "fox", "--library", library]);
    if (result.code !== 0) throw new Error(`导入样例书失败：${result.stderr}`);
    return {root, library, cleanup: () => rm(root, {recursive: true, force: true})};
}

export function runCli(args: string[], env: Record<string, string> = {}): Promise<{code: number | null; stdout: string; stderr: string}> {
    return new Promise((resolve, reject) => {
        const child = spawn("bun", [CLI, ...args], {stdio: ["ignore", "pipe", "pipe"], env: {...process.env, ...env}});
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", chunk => (stdout += chunk));
        child.stderr.on("data", chunk => (stderr += chunk));
        child.on("error", reject);
        child.on("exit", code => resolve({code, stdout, stderr}));
    });
}

/** `env` 补进服务进程的环境变量（例如指向测试配置的 XDG_CONFIG_HOME 与模型密钥）。 */
export async function startServe(library: string, env: Record<string, string> = {}): Promise<StoryServer> {
    const child: ChildProcess = spawn("bun", [CLI, "serve", "--library", library], {stdio: ["ignore", "pipe", "pipe"], env: {...process.env, ...env}});
    let output = "";
    const exited = new Promise<number | null>(resolve => child.on("exit", code => resolve(code)));
    const login = await new Promise<string>((resolve, reject) => {
        child.stdout!.on("data", chunk => {
            output += chunk;
            const match = /http:\/\/\S+\/login\?token=\S+/u.exec(output);
            if (match) resolve(match[0]);
        });
        child.stderr!.on("data", chunk => (output += chunk));
        void exited.then(code => reject(new Error(`serve 提前退出（${code}）：${output}`)));
    });
    return {
        library,
        login,
        base: login.slice(0, login.indexOf("/login")),
        async stop(signal = "SIGTERM") {
            if (child.exitCode === null) child.kill(signal);
            return exited;
        },
    };
}

/** 在一个浏览器配置里登录（拿到会话 Cookie）。 */
export async function login(context: BrowserContext, server: StoryServer): Promise<void> {
    const page = await context.newPage();
    await page.goto(server.login);
    await page.close();
}

/** 读书库里存下的阅读状态（经已登录的配置调 RPC）。 */
export async function readingState(context: BrowserContext, server: StoryServer): Promise<{position: {chapter: number; paragraph?: number}; view: Record<string, unknown> | null}> {
    const response = await context.request.post(`${server.base}/api/rpc/reading.get`, {data: {book: "fox"}});
    return (await response.json()) as never;
}

export interface ReplayServer {
    /** OpenAI 兼容端点的地址（写进配置的 baseUrl）。 */
    url: string;
    /** 关上或打开某一步的闸门（`章/步骤`，例如 `2/beats`）；关着时这一步的请求先等着。 */
    close(key: string): Promise<void>;
    open(key: string): Promise<void>;
    seen(): Promise<{chapter: number; step: string; round: number}[]>;
    stop(): Promise<void>;
}

/** 在 Bun 子进程里起回放端点（testing/replay-server.ts）：e2e 由 Node 运行，用不了 Bun.serve。 */
export async function startReplay(): Promise<ReplayServer> {
    const child = spawn("bun", [join(PACKAGE, "testing", "replay-server.ts")], {stdio: ["ignore", "pipe", "pipe"]});
    let output = "";
    const exited = new Promise<void>(resolve => child.on("exit", () => resolve()));
    const [url, control] = await new Promise<[string, string]>((resolve, reject) => {
        child.stdout.on("data", chunk => {
            output += chunk;
            const match = /^ready (\S+) (\S+)$/mu.exec(output);
            if (match) resolve([match[1]!, match[2]!]);
        });
        child.stderr.on("data", chunk => (output += chunk));
        void exited.then(() => reject(new Error(`回放端点提前退出：${output}`)));
    });
    const post = async (path: string, key: string) => {
        await fetch(`${control}${path}?key=${encodeURIComponent(key)}`, {method: "POST"});
    };
    return {
        url,
        close: key => post("/close", key),
        open: key => post("/open", key),
        seen: async () => (await (await fetch(`${control}/seen`)).json()) as never,
        async stop() {
            if (child.exitCode === null) child.kill("SIGTERM");
            await exited;
        },
    };
}

/** 问答页 e2e 用的模型端点（testing/qa-endpoint-server.ts）。回复的形状同 testing/openai-endpoint.ts 的 EndpointReply。 */
export interface QaEndpoint {
    url: string;
    /** 换一份脚本：之后的请求按顺序回复。 */
    script(replies: unknown[]): Promise<void>;
    /** 从下一个请求往后数第 `from` 个（缺省 0，即下一个）起先等着，直到 release。 */
    hold(from?: number): Promise<void>;
    release(): Promise<void>;
    /** 之后 `GET <端点>/models` 这样回（设置页读服务的模型列表）。 */
    models(reply: {kind: "models"; ids: string[]} | {kind: "status"; status: number}): Promise<void>;
    seen(): Promise<number>;
    /** 收到的每个请求的 JSON 正文。 */
    bodies(): Promise<Record<string, unknown>[]>;
    stop(): Promise<void>;
}

export async function startQaEndpoint(): Promise<QaEndpoint> {
    const child = spawn("bun", [join(PACKAGE, "testing", "qa-endpoint-server.ts")], {stdio: ["ignore", "pipe", "pipe"]});
    let output = "";
    const exited = new Promise<void>(resolve => child.on("exit", () => resolve()));
    const [url, control] = await new Promise<[string, string]>((resolve, reject) => {
        child.stdout.on("data", chunk => {
            output += chunk;
            const match = /^ready (\S+) (\S+)$/mu.exec(output);
            if (match) resolve([match[1]!, match[2]!]);
        });
        child.stderr.on("data", chunk => (output += chunk));
        void exited.then(() => reject(new Error(`问答端点提前退出：${output}`)));
    });
    const post = async (path: string, body?: unknown) => {
        await fetch(`${control}${path}`, {method: "POST", ...(body === undefined ? {} : {body: JSON.stringify(body), headers: {"content-type": "application/json"}})});
    };
    return {
        url,
        script: replies => post("/script", {replies}),
        hold: from => post(from === undefined ? "/hold" : `/hold?from=${from}`),
        release: () => post("/release"),
        models: reply => post("/models", reply),
        seen: async () => ((await (await fetch(`${control}/seen`)).json()) as {seen: number}).seen,
        bodies: async () => ((await (await fetch(`${control}/bodies`)).json()) as {bodies: Record<string, unknown>[]}).bodies,
        async stop() {
            if (child.exitCode === null) child.kill("SIGTERM");
            await exited;
        },
    };
}

/** 样例书前 `chapters` 章拼回的 TXT 原文（同 testing/sample.ts 的 sampleSourceText；e2e 由 Node 运行，不导入 Bun 的测试工具）。 */
export async function sampleSourceText(chapters: number): Promise<string> {
    const sample = JSON.parse(gunzipSync(await readFile(join(PACKAGE, "tests", "fixtures", "sample-100ch.json.gz"))).toString("utf8")) as {sources: {paragraphs: string[]}[]};
    return `转生反派萝莉，找茬魔法少女\n作者：测试\n\n${sample.sources.slice(0, chapters).map(source => source.paragraphs.join("\n")).join("\n\n")}`;
}

/**
 * 只抽了前 `committed` 章的书（书 id `fox`）：书里只有这几章的记录，`.ingest/fox/source.json` 放着前 `total` 章的原文，
 * 后面几章是未抽取的尾部（w00024 t30）。截取方式同 testing/sample.ts 的 `smallDataset`。
 */
export async function makePartialLibrary(name: string, committed: number, total: number): Promise<{root: string; library: string; cleanup(): Promise<void>}> {
    const root = await createTestTmpRoot(`nb-story-e2e-${name}`, `nb-story e2e ${name}`);
    const library = join(root, "library");
    const full = JSON.parse(gunzipSync(await readFile(join(PACKAGE, "tests", "fixtures", "sample-100ch.json.gz"))).toString("utf8")) as Record<string, unknown> & {sources: {chapter: number; paragraphs: unknown[]}[]};
    const keep = (records: unknown): unknown => (records as {at: {chapter: number}}[]).filter(record => record.at.chapter <= committed);
    const sources = full.sources.filter(chapter => chapter.chapter <= committed);
    const small: Record<string, unknown> = {...full, through: {chapter: committed, paragraph: sources.at(-1)!.paragraphs.length}, sources};
    for (const key of ["entities", "mentions", "times", "beats", "statements", "secrets", "episodes", "knowledge", "ledger", "questions", "summaries", "arcs"]) small[key] = keep(full[key]);
    const file = join(root, "partial.json");
    await writeFile(file, JSON.stringify(small));
    const result = await runCli(["import", file, "--title", "转生反派萝莉，找茬魔法少女", "--id", "fox", "--library", library]);
    if (result.code !== 0) throw new Error(`导入部分抽取的书失败：${result.stderr}`);
    const dir = join(library, ".ingest", "fox");
    await mkdir(dir, {recursive: true});
    await writeFile(join(dir, "source.json"), JSON.stringify({id: "fox", title: "转生反派萝莉，找茬魔法少女", chapters: full.sources.filter(chapter => chapter.chapter <= total), preambleChars: 0, volumeLines: 0, createdAt: "2026-10-27T00:00:00.000Z"}));
    return {root, library, cleanup: () => rm(root, {recursive: true, force: true})};
}

/** 等画布稳定：相隔 300ms 的两次轮询截图相同（WebGL 动画中连着两帧也可能一样，间隔太短会误判）。 */
export async function settle(page: Page): Promise<void> {
    const graph = page.getByTestId("relation-graph");
    let previous: Buffer | null = null;
    await expect.poll(async () => {
        const current = await graph.screenshot();
        const same = previous !== null && current.equals(previous);
        previous = current;
        return same;
    }, {intervals: [300]}).toBe(true);
}

/** 用“在图里找”把镜头移到一个点上：命中的点被移到画布中央。 */
export async function centerOn(page: Page, name: string): Promise<{x: number; y: number}> {
    const graph = page.getByTestId("relation-graph");
    await settle(page);
    const before = await graph.screenshot();
    await page.getByPlaceholder("在图里找").fill(name);
    await expect.poll(async () => !(await graph.screenshot()).equals(before)).toBe(true);
    await settle(page);
    const box = (await graph.boundingBox())!;
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}
