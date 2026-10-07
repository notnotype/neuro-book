/**
 * Storage 在真实 Chrome 中的验收（docs/specs/storage/persistence.md 场景 3、4、7 与项目记录跨窗口、跨项目代次）：
 * e2e 测试外壳里的测试插件 `test.remote-probe` 以自己的身份经 `nbook.storage` 读写三条示例记录
 * （`window.__nbRemoteProbe.storage`），后端是宿主测试入口起的真实服务端与项目子进程；同一插件的服务端入口与项目
 * 入口直用 Storage，经服务端探针的控制路由读写（`src/server/testing/test-plugins.ts`）。两个浏览器上下文的本地
 * 存储互不相通，各是一个客户端；同一上下文的两个标签页是同一个客户端。
 */

import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Browser, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";

import type {WriteResult} from "nbook/shared/storage";
import {ProbeReadSchema} from "nbook/shared/testing/probe-storage";
import type {ProbeRead} from "nbook/shared/testing/probe-storage";
// 同时带来 `window.__nbRemoteProbe` 的全局类型。
import type {ProbeRecordName} from "nbook/web/testing/remote-probe";

import {startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

const GRACE_MS = 1500;
/** 项目探针的项目入口关闭时打印的一行（`src/project/testing/probe-plugin.ts`）。 */
const PROJECT_PROBE_CLOSED_LINE = "remote-probe project entry closed";

let tmp = "";
let projectId = "";
let server: ProbeServer;

/** 先登记好项目 `book`：身份文件与登记表按 docs/specs/runtime/projects.md 的格式写入，不经界面。 */
test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "storage");
    const projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    const id = randomUUID();
    projectId = id;
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(projectDir, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProbeServer(stateRoot, {env: {NBOOK_PROJECT_GRACE_MS: String(GRACE_MS)}});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 在一个新的浏览器上下文（一个新客户端）里打开窗口。 */
async function client(browser: Browser): Promise<Page> {
    const context = await browser.newContext();
    return context.newPage();
}

async function open(page: Page, bound = true): Promise<void> {
    await page.goto(bound ? new URL("/?project=book", server.url).href : server.url);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect.poll(() => page.evaluate(() => window.__nbRemoteProbe !== undefined)).toBe(true);
}

function read(page: Page, name: ProbeRecordName): Promise<ProbeRead> {
    return page.evaluate((record) => window.__nbRemoteProbe!.storage.read(record), name);
}

function save(page: Page, name: ProbeRecordName, text: string, expectRevision: string | null): Promise<WriteResult> {
    return page.evaluate(([record, value, revision]) => window.__nbRemoteProbe!.storage.save(record, value, revision), [name, text, expectRevision] as const);
}

/** 读到的 revision，作下一次保存的 `expect`；从未写过或读失败为 null。 */
function revisionOf(result: Static<typeof ProbeReadSchema>): string | null {
    return "revision" in result ? result.revision : null;
}

test("local 记录按客户端分开：另一个浏览器上下文看不到，同一上下文的另一个标签页共用", async ({browser}) => {
    const first = await client(browser);
    await open(first, false);
    expect(await read(first, "local")).toEqual({status: "missing", revision: null});
    expect(await save(first, "local", "一号客户端", null)).toMatchObject({ok: true});

    const other = await client(browser);
    await open(other, false);
    expect(await read(other, "local")).toEqual({status: "missing", revision: null});

    const sibling = await first.context().newPage();
    await open(sibling, false);
    expect(await read(sibling, "local")).toMatchObject({status: "ok", value: {text: "一号客户端"}});
    await first.context().close();
    await other.context().close();
});

test("同一客户端的两个标签页以同一 revision 保存：一个成功、另一个 conflict；订阅收到另一个窗口的写入", async ({browser}) => {
    const left = await client(browser);
    const right = await left.context().newPage();
    await open(left, false);
    await open(right, false);
    const revision = revisionOf(await read(left, "shared"));
    expect(await watch(right, "shared")).toBe(true);

    expect(await save(left, "shared", "左边先写", revision)).toMatchObject({ok: true});
    expect(await save(right, "shared", "右边后写", revision)).toMatchObject({ok: false, code: "conflict"});

    await expect.poll(() => right.evaluate(() => window.__nbRemoteProbe!.storage.seen.shared.map((snapshot) => snapshot.status === "ok" ? snapshot.value.text : snapshot.status))).toContain("左边先写");
    await left.context().close();
});

test("项目记录跨窗口共享；没有页面使用项目、子进程退出后再打开，新代次读到磁盘上的值", async ({browser}) => {
    const first = await client(browser);
    await open(first);
    const generation = await projectGeneration(first);
    expect(await save(first, "project", "写进项目", revisionOf(await read(first, "project")))).toMatchObject({ok: true});

    const second = await client(browser);
    await open(second);
    expect(await read(second, "project")).toMatchObject({status: "ok", value: {text: "写进项目"}});
    // 没有绑定项目的窗口打开项目记录：no-project。
    const unbound = await second.context().newPage();
    await open(unbound, false);
    expect(await read(unbound, "project")).toMatchObject({ok: false, code: "no-project"});

    await first.context().close();
    await second.context().close();
    await server.waitFor(new RegExp(`\\[project book#${String(generation)}\\] ${PROJECT_PROBE_CLOSED_LINE}`, "u"));

    const reopened = await client(browser);
    await open(reopened);
    expect(await projectGeneration(reopened)).toBeGreaterThan(generation);
    expect(await read(reopened, "project")).toMatchObject({status: "ok", value: {text: "写进项目"}});
    await reopened.context().close();
});

test("服务端与项目实例里的同一插件直用 Storage：与窗口经代理读写的是同一条记录", async ({browser}) => {
    const page = await client(browser);
    await open(page);

    expect(await save(page, "shared", "窗口写", revisionOf(await read(page, "shared")))).toMatchObject({ok: true});
    const atServer = decoded(ProbeReadSchema, await probeApi("GET", "storage/shared"));
    expect(atServer).toMatchObject({status: "ok", value: {text: "窗口写"}});
    expect(await probeApi("POST", "storage/shared", {text: "服务端写", expect: revisionOf(atServer)})).toMatchObject({ok: true});
    expect(await read(page, "shared")).toMatchObject({status: "ok", value: {text: "服务端写"}});
    expect(await probeApi("GET", "storage/local")).toMatchObject({ok: false, code: "no-client"});
    expect(await probeApi("GET", "storage/project")).toMatchObject({ok: false, code: "no-project"});

    expect(await save(page, "project", "窗口写项目", revisionOf(await read(page, "project")))).toMatchObject({ok: true});
    // 经项目探针的远程调用：回应是远程调用的结果，成功时 `value` 是项目入口读到的结果。
    const atProject = decoded(Type.Object({ok: Type.Literal(true), value: ProbeReadSchema}), await probeApi("GET", `project/${projectId}/storage/project`));
    expect(atProject.value).toMatchObject({status: "ok", value: {text: "窗口写项目"}});
    expect(await probeApi("POST", `project/${projectId}/storage/project`, {text: "项目写", expect: revisionOf(atProject.value)})).toMatchObject({ok: true, value: {ok: true}});
    expect(await read(page, "project")).toMatchObject({status: "ok", value: {text: "项目写"}});
    await page.context().close();
});

/** 服务端探针的控制路由（`/api/test.remote-probe/…`）。 */
async function probeApi(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(new URL(`/api/test.remote-probe/${path}`, server.url), body === undefined ? {method} : {method, headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
    expect(response.status).toBe(200);
    return response.json();
}

/** 按 schema 核对控制路由的回应，不符时连同回应一起报错。 */
function decoded<Schema extends TSchema>(schema: Schema, value: unknown): Static<Schema> {
    if (!Value.Check(schema, value)) throw new Error(`控制路由的回应不符合探针的结果形状：${JSON.stringify(value)}`);
    return value;
}

function watch(target: Page, name: ProbeRecordName): Promise<boolean> {
    return target.evaluate((record) => window.__nbRemoteProbe!.storage.watch(record), name);
}

async function projectGeneration(target: Page): Promise<number> {
    await expect.poll(() => target.evaluate(() => window.__nbRemoteProbe?.project !== null && window.__nbRemoteProbe?.project !== undefined)).toBe(true);
    const echo = await target.evaluate(() => window.__nbRemoteProbe!.project!.echo()) as {readonly ok: boolean; readonly value?: {readonly project: {readonly generation: number}}};
    expect(echo.ok).toBe(true);
    return echo.value!.project.generation;
}
