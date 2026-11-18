/**
 * 独立服务里的抽取（docs/specs/story/ingest.md 的“网页”、输出 3、11、12、16，验收 4、8、10；viewer 验收 9 的服务部分）：
 * 真实的 `serve` 进程与 HTTP，模型是本机端点回放 w00005 t34 录下的回复。要让任务停在某一步时，端点对那一步不回应
 * （`hang`），直到请求被取消。
 *
 * 服务读默认位置的配置：子进程的 XDG_CONFIG_HOME 指向用例自己的目录。密钥是测试里编的假值，只发往本机端点。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {existsSync, watch} from "node:fs";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {tryLock} from "@notnotype/nb-flock";

import {loadReplay, replay, type Replay, type ReplayKey} from "../../testing/ingest-replay";
import {commitFinalPrefix} from "../../testing/ingest-state";
import {startEndpoint, type Endpoint, type EndpointReply} from "../../testing/openai-endpoint";
import {CLI, loginCookie, rpc, startServe, type ServeProcess} from "../../testing/processes";
import {makeSampleRoot, sampleSourceText} from "../../testing/sample";
import {Library} from "../core/library";
import type {IngestStatusView} from "../contract/contract";
import {INGEST_BODY_LIMIT} from "./http";

const KEY_ENV = "NBSTORY_SERVE_INGEST_TEST_CREDENTIAL";
const FAKE_KEY = "fake-serve-ingest-credential-0042";

let root = "";
let counter = 0;
const cleanups: (() => Promise<unknown> | unknown)[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("nb-story", "serve-ingest");
});
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const hang: EndpointReply = {kind: "hang"};
const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

interface Env {
    dir: string;
    library: string;
    played: Replay;
    endpoint: Endpoint;
    childEnv: Record<string, string>;
    serve: ServeProcess;
    cookie: string;
    call(method: string, params: unknown): Promise<{status: number; body: unknown}>;
    status(book: string): Promise<IngestStatusView>;
}

async function setup(override?: (key: ReplayKey, nth: number) => EndpointReply | undefined, prepare?: (library: string) => Promise<void>): Promise<Env> {
    counter += 1;
    const dir = join(root, `case-${counter}`);
    const configHome = join(dir, "xdg");
    await mkdir(join(configHome, "nbstory"), {recursive: true});
    const played = replay(await loadReplay(), override);
    const endpoint = startEndpoint(played.responder);
    cleanups.push(() => endpoint.stop());
    // 录下的回放里没有马甲核对这一步：公共配置显式关掉，开着的场景单独测（输出 20）。
    await writeFile(join(configHome, "nbstory", "config.json"), JSON.stringify({model: {baseUrl: endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV, price: {input: 1, output: 4, currency: "USD"}}, ingest: {personaCheck: {enabled: false}}}));
    const library = join(dir, "library");
    await prepare?.(library);
    const childEnv = {XDG_CONFIG_HOME: configHome, [KEY_ENV]: FAKE_KEY};
    const serve = await startServe(library, childEnv);
    cleanups.push(() => serve.stop("SIGKILL"));
    const cookie = await loginCookie(serve.login!);
    const call = (method: string, params: unknown) => rpc(serve.base!, method, params, cookie);
    const status = async (book: string) => {
        const result = await call("ingest.status", {book});
        if (result.status !== 200) throw new Error(`ingest.status 失败：${JSON.stringify(result.body)}`);
        return (result.body as {books: IngestStatusView[]}).books[0]!;
    };
    return {dir, library, played, endpoint, childEnv, serve, cookie, call, status};
}

const errorCode = (result: {body: unknown}) => (result.body as {code?: string}).code;

describe("挑相关说法开着时的进度（ingest.md 输出 4、13）", () => {
    test("正在挑第 2 章的说法：ingest.status 的当前步骤是 recall；停止照常", async () => {
        const env = await setup(key => (key.step === "recall" ? hang : undefined));
        // 服务每次发起时读配置：改了就生效。
        await writeFile(join(env.childEnv.XDG_CONFIG_HOME!, "nbstory", "config.json"), JSON.stringify({model: {baseUrl: env.endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}, ingest: {recall: {enabled: true}, personaCheck: {enabled: false}}}));
        const started = await env.call("ingest.start", {content: base64(await sampleSourceText(3)), title: "转生反派萝莉"});
        const id = (started.body as {id: string}).id;
        await waitUntil("第 2 章挑说法", async () => {
            const status = await env.status(id);
            return status.current?.chapter === 2 && status.current.step === "recall";
        }, {timeoutMs: 60_000});
        expect((await env.call("ingest.stop", {book: id})).status).toBe(200);
        await waitUntil("停下", async () => (await env.status(id)).state === "stopped", {timeoutMs: 30_000});
        expect((await env.status(id)).committed).toBe(1);
    }, 120_000);
});

describe("马甲核对（ingest.md 输出 20）", () => {
    test("配置里不写这一节：默认开，第 3 章核对风信子时进度的当前步骤是 persona；写 enabled: false：不发这一步", async () => {
        const env = await setup(key => (key.step === "persona" ? hang : undefined));
        const configFile = join(env.childEnv.XDG_CONFIG_HOME!, "nbstory", "config.json");
        // 服务每次发起时读配置：去掉这一节就是默认开。
        await writeFile(configFile, JSON.stringify({model: {baseUrl: env.endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}}));
        const started = await env.call("ingest.start", {content: base64(await sampleSourceText(5)), title: "默认开"});
        const id = (started.body as {id: string}).id;
        await waitUntil("第 3 章核对马甲", async () => {
            const status = await env.status(id);
            return status.current?.chapter === 3 && status.current.step === "persona";
        }, {timeoutMs: 60_000});
        expect((await env.call("ingest.stop", {book: id})).status).toBe(200);
        await waitUntil("停下", async () => (await env.status(id)).state === "stopped", {timeoutMs: 30_000});

        const before = env.played.seen.filter(key => key.step === "persona").length;
        await writeFile(configFile, JSON.stringify({model: {baseUrl: env.endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}, ingest: {personaCheck: {enabled: false}}}));
        const off = await env.call("ingest.start", {content: base64(await sampleSourceText(5)), title: "关着"});
        const offId = (off.body as {id: string}).id;
        await waitUntil("抽完", async () => (await env.status(offId)).state === "done", {timeoutMs: 120_000});
        expect(env.played.seen.filter(key => key.step === "persona").length).toBe(before);
        expect(env.played.unknown).toEqual([]);
    }, 240_000);
});

describe("按书关闭数值与秘密（ingest.md 输出 18）", () => {
    test("预览与开始收开关，进度与书单给出生效值；已有抽取记录时给了不同的值：invalid_params（400），不改；预览也一样", async () => {
        const env = await setup(key => (key.chapter === 2 && key.step === "beats" ? hang : undefined));
        const content = base64(await sampleSourceText(3));
        const off = {ledger: true, secrets: false};

        const preview = await env.call("ingest.preview", {content, title: "开关", features: {secrets: false}});
        expect((preview.body as {action: string; features: unknown})).toMatchObject({action: "new", features: off});
        expect((await env.call("ingest.preview", {content, title: "开关"})).body).toMatchObject({features: {ledger: true, secrets: true}});

        const started = await env.call("ingest.start", {content, title: "开关", features: {secrets: false}});
        const id = (started.body as {id: string}).id;
        await waitUntil("第 1 章提交", async () => (await env.status(id)).committed === 1, {timeoutMs: 60_000});
        expect((await env.status(id)).features).toEqual(off);
        const books = (await env.call("books.list", {})).body as {books: {id: string; features: unknown}[]};
        expect(books.books.find(book => book.id === id)?.features).toEqual(off);
        expect(((await env.call("book.info", {book: id})).body as {features: unknown}).features).toEqual(off);
        expect((await env.call("ingest.stop", {book: id})).status).toBe(200);
        await waitUntil("停下", async () => (await env.status(id)).state === "stopped", {timeoutMs: 30_000});

        for (const [method, params] of [
            ["ingest.preview", {content, title: "开关", features: {secrets: true}}],
            ["ingest.start", {content, title: "开关", features: {secrets: true}}],
            ["ingest.start", {book: id, features: {ledger: false}}],
        ] as const) {
            const result = await env.call(method, params);
            expect({method, status: result.status, code: errorCode(result)}).toEqual({method, status: 400, code: "invalid_params"});
        }
        expect((await env.status(id))).toMatchObject({state: "stopped", committed: 1, features: off});
        // 给相同的值、或不给：照常。
        expect((await env.call("ingest.preview", {content, title: "开关", features: {secrets: false}})).body).toMatchObject({action: "resume", features: off});
        expect((await env.call("ingest.preview", {content, title: "开关"})).body).toMatchObject({action: "resume", features: off});
    }, 120_000);
});

describe("预览、发起、停止、继续（viewer 验收 9 的服务部分）", () => {
    test("预览写明新书 10 章与抽取模型；第 3 章草稿时停止：书是 2 章、用户停止；继续接着抽完", async () => {
        let hold = true;
        const env = await setup(key => (hold && key.chapter === 3 && key.step === "draft" ? hang : undefined));
        const content = base64(await sampleSourceText(10));

        const preview = await env.call("ingest.preview", {content, title: "转生反派萝莉"});
        expect(preview.status).toBe(200);
        const plan = preview.body as {id: string; action: string; chapters: unknown[]; model: unknown};
        expect({action: plan.action, chapters: plan.chapters.length, model: plan.model}).toEqual({action: "new", chapters: 10, model: {id: "qa-model", source: "model"}});
        expect(env.endpoint.bodies).toEqual([]);

        // 问答的默认模型换成目录里的模型、又没写抽取模型：预览写明抽取要单独写模型（qa.md 输出 23）。
        const configFile = join(env.childEnv.XDG_CONFIG_HOME!, "nbstory", "config.json");
        const saved = await readFile(configFile, "utf8");
        await writeFile(configFile, JSON.stringify({models: ["deepseek/deepseek-flash"], model: {use: "deepseek/deepseek-flash"}}));
        const unusable = (await env.call("ingest.preview", {content, title: "转生反派萝莉"})).body as {model: unknown; modelProblem: string | null};
        expect(unusable.model).toBeNull();
        expect(unusable.modelProblem).toContain("抽取要单独写模型");
        await writeFile(configFile, saved);

        const started = await env.call("ingest.start", {content, title: "转生反派萝莉"});
        expect(started.body).toEqual({id: plan.id, action: "new"});
        await waitUntil("第 3 章草稿", async () => (await env.status(plan.id)).current?.step === "draft" && (await env.status(plan.id)).current?.chapter === 3, {timeoutMs: 60_000});
        const running = await env.status(plan.id);
        expect({state: running.state, runner: running.runner, committed: running.committed}).toEqual({state: "running", runner: "serve", committed: 2});
        const books = await env.call("books.list", {});
        expect((books.body as {books: {id: string; chapters: number}[]}).books.map(book => [book.id, book.chapters])).toEqual([[plan.id, 2]]);

        expect((await env.call("ingest.stop", {book: plan.id})).status).toBe(200);
        await waitUntil("停下", async () => (await env.status(plan.id)).state === "stopped", {timeoutMs: 30_000});
        const stopped = await env.status(plan.id);
        expect({reason: stopped.stopReason, committed: stopped.committed}).toEqual({reason: {kind: "user"}, committed: 2});

        hold = false;
        expect((await env.call("ingest.start", {book: plan.id})).body).toEqual({id: plan.id, action: "resume"});
        await waitUntil("抽完", async () => (await env.status(plan.id)).state === "done", {timeoutMs: 120_000});
        expect(env.played.unknown).toEqual([]);
        expect(new Set(env.endpoint.authorizations)).toEqual(new Set([`Bearer ${FAKE_KEY}`]));
    }, 240_000);

    test("坏的原文：不是 base64 得到 invalid_params，不是 UTF-8 得到 ingest_bad_text，请求体超过上限得到 ingest_bad_text", async () => {
        const env = await setup();
        const notBase64 = await env.call("ingest.preview", {content: "不是base64", title: "x"});
        expect({status: notBase64.status, code: errorCode(notBase64)}).toEqual({status: 400, code: "invalid_params"});
        const gbk = await env.call("ingest.preview", {content: Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]).toString("base64"), title: "x"});
        expect({status: gbk.status, code: errorCode(gbk)}).toEqual({status: 400, code: "ingest_bad_text"});
        const huge = await env.call("ingest.preview", JSON.stringify({content: "A".repeat(INGEST_BODY_LIMIT), title: "x"}));
        expect({status: huge.status, code: errorCode(huge)}).toEqual({status: 400, code: "ingest_bad_text"});
        // 分块传输（没有 Content-Length）同样按上限拒绝：正文是合法的小原文加超出上限的空白。
        const small = JSON.stringify({content: base64(await sampleSourceText(1)), title: "x"});
        const padding = INGEST_BODY_LIMIT - small.length + 1024;
        const encoder = new TextEncoder();
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent === 0) controller.enqueue(encoder.encode(small.slice(0, -1)));
                const size = Math.min(1024 * 1024, padding - sent);
                if (size <= 0) {
                    controller.enqueue(encoder.encode("}"));
                    controller.close();
                    return;
                }
                controller.enqueue(encoder.encode(" ".repeat(size)));
                sent += size;
            },
        });
        const chunked = await fetch(`${env.serve.base}/api/rpc/ingest.preview`, {method: "POST", headers: {"content-type": "application/json", cookie: env.cookie}, body});
        expect({status: chunked.status, code: ((await chunked.json()) as {code: string}).code}).toEqual({status: 400, code: "ingest_bad_text"});
        // 没有配置时预览照常，只是不写模型；开始得到 qa_unconfigured。
        await rm(join(env.childEnv.XDG_CONFIG_HOME!, "nbstory", "config.json"));
        const content = base64(await sampleSourceText(2));
        expect(((await env.call("ingest.preview", {content, title: "x"})).body as {model: unknown}).model).toBeNull();
        const start = await env.call("ingest.start", {content, title: "x"});
        expect({status: start.status, code: errorCode(start)}).toEqual({status: 400, code: "qa_unconfigured"});
    }, 60_000);
});

describe("别的进程在抽（验收 4）", () => {
    test("命令行运行的任务：网页发起、停止与删除都得到 ingest_running，进度显示由命令行运行", async () => {
        const env = await setup(key => (key.chapter === 2 ? hang : undefined));
        const file = join(env.dir, "sample.txt");
        await writeFile(file, await sampleSourceText(5));
        const child = Bun.spawn(["bun", CLI, "ingest", file, "--library", env.library], {stdout: "pipe", stderr: "pipe", env: {...process.env, ...env.childEnv}});
        cleanups.push(async () => {
            child.kill("SIGKILL");
            await child.exited;
        });
        await waitUntil("第 2 章的请求", () => env.played.seen.some(key => key.chapter === 2), {timeoutMs: 60_000});

        expect((await env.status("sample")).runner).toBe("cli");
        const start = await env.call("ingest.start", {content: base64(await sampleSourceText(5)), title: "sample"});
        expect({status: start.status, code: errorCode(start)}).toEqual({status: 409, code: "ingest_running"});
        const stop = await env.call("ingest.stop", {book: "sample"});
        expect({status: stop.status, code: errorCode(stop)}).toEqual({status: 409, code: "ingest_running"});
        const remove = await env.call("book.remove", {book: "sample"});
        expect({status: remove.status, code: errorCode(remove)}).toEqual({status: 409, code: "ingest_running"});
        expect((await env.call("book.info", {book: "sample"})).status).toBe(200);
    }, 120_000);
});

describe("删除与服务停止（验收 8，输出 11）", () => {
    test("网页发起的任务运行中删除这本书：任务停下，书与抽取记录都不在，同 id 再发起是 new", async () => {
        const env = await setup(key => (key.chapter === 2 && key.step === "draft" ? hang : undefined));
        const content = base64(await sampleSourceText(5));
        await env.call("ingest.start", {content, title: "要删的书", id: "doomed"});
        await waitUntil("第 2 章草稿请求", () => env.played.seen.some(key => key.chapter === 2 && key.step === "draft"), {timeoutMs: 60_000});
        expect((await env.call("book.remove", {book: "doomed"})).status).toBe(200);
        expect((await env.call("ingest.status", {})).body).toEqual({books: []});
        expect((await env.call("books.list", {})).body).toEqual({books: []});
        expect((await readdir(env.library)).filter(name => !name.startsWith("."))).toEqual(["library.json"]);
        expect((await env.call("ingest.start", {content, title: "要删的书", id: "doomed"})).body).toEqual({id: "doomed", action: "new"});
    }, 120_000);

    test("发起还在启动（已拿到锁、还没有任务）时删除：等它启动完、停下，再删；书与抽取记录都不在", async () => {
        const env = await setup(() => hang);
        await mkdir(join(env.library, ".locks"), {recursive: true});
        let removal: Promise<{status: number; body: unknown}> | null = null;
        // 锁文件一出现就删除：这时发起已经拿到锁，任务还没交回给服务。
        const watcher = watch(join(env.library, ".locks"), (_event, name) => {
            if (removal === null && name === "early.lock") removal = env.call("book.remove", {book: "early"});
        });
        cleanups.push(() => watcher.close());
        const started = await env.call("ingest.start", {content: base64(await sampleSourceText(2)), title: "早删", id: "early"});
        expect(started.status).toBe(200);
        await waitUntil("删除发起", () => removal !== null, {timeoutMs: 30_000});
        expect((await removal!).status).toBe(200);
        expect((await env.call("ingest.status", {})).body).toEqual({books: []});
        expect((await env.call("books.list", {})).body).toEqual({books: []});
    }, 60_000);

    test("服务正在启动一个发起时停服：等它启动完再停下、放锁，再撤销登记、退出；之后报用户停止", async () => {
        const env = await setup(() => hang);
        await mkdir(join(env.library, ".locks"), {recursive: true});
        let stopping: Promise<number> | null = null;
        const watcher = watch(join(env.library, ".locks"), (_event, name) => {
            if (stopping === null && name === "racing.lock") stopping = env.serve.stop("SIGTERM");
        });
        cleanups.push(() => watcher.close());
        // 登记一被撤销就去拿这本书的锁：停服的顺序是先停任务、放锁，再撤销登记，所以这时一定拿得到。
        const atWithdraw: {lockFree: boolean | null} = {lockFree: null};
        const registration = watch(env.library, (_event, name) => {
            if (atWithdraw.lockFree !== null || name !== ".serve.json" || existsSync(join(env.library, ".serve.json"))) return;
            const lock = tryLock(join(env.library, ".locks", "racing.lock"));
            atWithdraw.lockFree = lock !== null;
            lock?.release();
        });
        cleanups.push(() => registration.close());
        // 停服可能先于回包：这次请求失败不要紧，看停服之后书库里的状态。
        await env.call("ingest.start", {content: base64(await sampleSourceText(2)), title: "抢着停", id: "racing"}).catch(() => null);
        await waitUntil("停服发起", () => stopping !== null, {timeoutMs: 30_000});
        expect(await stopping!).toBe(0);
        expect(atWithdraw.lockFree).toBe(true);
        const {ingestStatus} = await import("../ingest/status");
        const status = await ingestStatus(new Library(env.library), "racing");
        expect({state: status?.state, reason: status?.stopReason}).toEqual({state: "stopped", reason: {kind: "user"}});
    }, 60_000);

    test("服务停止：先停下本服务的任务、放锁，再退出；之后报用户停止，可以接着抽", async () => {
        const env = await setup(key => (key.chapter === 2 ? hang : undefined));
        await env.call("ingest.start", {content: base64(await sampleSourceText(5)), title: "sample"});
        await waitUntil("第 2 章的请求", () => env.played.seen.some(key => key.chapter === 2), {timeoutMs: 60_000});
        expect(await env.serve.stop("SIGTERM")).toBe(0);
        const {ingestStatus} = await import("../ingest/status");
        const status = await ingestStatus(new Library(env.library), "sample");
        expect({state: status?.state, reason: status?.stopReason, committed: status?.committed}).toEqual({state: "stopped", reason: {kind: "user"}, committed: 1});
    }, 120_000);
});

describe("抽取期间照常可用（验收 10）", () => {
    /**
     * 前 98 章用 t34 的最终草稿直接提交，只回放第 99、100 章（第 100 章是末章，带整理）。我们编译出的前 98 章与 t34
     * 当时不完全相同（S1 的三处有意改动），核对之后剩下的问题也就不同，t34 没有修复的章这里可能要修复：给一个空补丁，
     * 剩下的由兜底丢弃。这个用例只看服务响应，不看抽取结果。
     *
     * 约 15 秒：第 99 章的兜底丢弃要反复编译 98 章的全书（一次约半秒），抽取线程一直满载。正是要在这样的负载下看服务
     * 还应不应答，所以不能缩小。
     */
    test("100 章的书抽第 99 章：提交前后另一本书的查询与进度都在 1 秒内返回；第 100 章中停止，5 秒起不再请求模型、不再提交", async () => {
        /** 端点收到每个请求的时刻。 */
        const arrivals: number[] = [];
        const env = await setup(
            key => {
                arrivals.push(performance.now());
                return key.step === "repair-1" ? {kind: "text", text: "{}"} : undefined;
            },
            async library => {
                const books = new Library(library);
                await commitFinalPrefix(books, {id: "long", title: "一百章", through: 98});
                const sample = await makeSampleRoot("serve-ingest-other");
                cleanups.push(() => rm(sample.root, {recursive: true, force: true}));
                await books.importBook({file: sample.file, title: "另一本", id: "other"});
            },
        );
        const latencies: {method: string; ms: number; committed: number}[] = [];
        let committed = 98;
        let polling = true;
        let pollFailure: unknown = null;
        // 每次都要成功：快速返回的错误不算“照常可用”。
        const timed = async (method: string, params: unknown) => {
            const started = performance.now();
            const result = await env.call(method, params);
            latencies.push({method, ms: performance.now() - started, committed});
            if (result.status !== 200) throw new Error(`${method} 失败：${result.status} ${JSON.stringify(result.body)}`);
            return result;
        };
        // 不停地查另一本书与进度，直到任务结束；每次都记下用时。
        const poller = (async () => {
            while (polling) {
                expect(((await timed("book.info", {book: "other"})).body as {title: string}).title).toBe("另一本");
                expect(((await timed("entities.list", {book: "other", limit: 20})).body as {items: unknown[]}).items).toHaveLength(20);
                const status = await timed("ingest.status", {book: "long"});
                committed = (status.body as {books: IngestStatusView[]}).books[0]?.committed ?? committed;
            }
        })().catch((error: unknown) => {
            pollFailure = error;
        });
        /** 查询一失败就让正在等的地方立刻失败，不等到超时。 */
        const healthy = () => {
            if (pollFailure !== null) throw pollFailure;
        };
        cleanups.push(async () => {
            polling = false;
            await poller;
        });

        expect((await env.call("ingest.start", {book: "long"})).body).toEqual({id: "long", action: "resume"});
        await waitUntil("第 99 章提交", () => (healthy(), committed >= 99), {timeoutMs: 120_000});
        // 第 100 章刚开始就停止。
        await waitUntil("第 100 章的请求", () => env.played.seen.some(key => key.chapter === 100), {timeoutMs: 60_000});
        const stoppedAt = performance.now();
        expect((await timed("ingest.stop", {book: "long"})).status).toBe(200);
        await waitUntil("停下", async () => (await env.status("long")).state === "stopped", {timeoutMs: 30_000});
        expect((await env.status("long")).committed).toBe(99);
        expect(arrivals.filter(at => at > stoppedAt + 5_000)).toEqual([]);
        polling = false;
        await poller;
        healthy();

        expect(env.played.unknown).toEqual([]);
        expect(latencies.filter(item => item.committed === 98).length).toBeGreaterThan(0);
        expect(latencies.filter(item => item.committed === 99).length).toBeGreaterThan(0);
        expect(latencies.filter(item => item.ms >= 1000)).toEqual([]);
    }, 240_000);
});
