import {afterEach, describe, expect, test} from "bun:test";
import {spawn} from "node:child_process";
import {randomBytes, randomUUID} from "node:crypto";
import {once} from "node:events";
import {readdir, readFile, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {submitAnswer} from "../src/core/artifact-ops.js";
import {readArtifact} from "../src/core/artifacts.js";
import {askerOf} from "../src/core/provenance.js";
import {locateRepository} from "../src/core/repo.js";
import {CLI_PATH, cleanupFixtures, createFixture, git, run, taskReadme, type CliEnvelope, type Fixture} from "./git-fixture.js";
import {startFakeClaude, type FakeClaude} from "./processes.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0)) await close();
    await cleanupFixtures();
});

const TASK_DIR = ".agents/works/w00001-seed/tasks/t01-seed";
const DIR = `${TASK_DIR}/artifacts/review`;
const REF = {workId: "w00001-seed", taskId: "t01-seed", artifactId: "review"};
const BOARD = resolve(import.meta.dirname, "fixtures/t03-review/index.html");
const NO_PARSE5 = resolve(import.meta.dirname, "no-parse5-preload.ts");

function page(first = "layout"): string {
    return [
        "<!doctype html><title>评审板</title>",
        `<section data-nbdev-question="${first}" data-nbdev-type="single"><h2>版式</h2>`,
        '<div data-nbdev-option="cards"><h3>卡片</h3></div><div data-nbdev-option="table"><h3>表</h3></div></section>',
        '<section data-nbdev-question="approve" data-nbdev-type="confirm"><h2>批准</h2></section>',
    ].join("\n");
}

function data<T>(envelope: CliEnvelope | null): T {
    return envelope?.data as T;
}

/** 一次发布的提交里的文件（仓库根相对，排好序）；中文路径不转义。 */
async function committed(fixture: Fixture, result: {json: CliEnvelope | null}): Promise<string[]> {
    const sha = data<{commit: {sha: string}}>(result.json).commit.sha;
    return (await git(fixture.main, "-c", "core.quotepath=off", "diff-tree", "--no-commit-id", "--name-only", "-r", sha)).split("\n").filter(Boolean).sort();
}

async function published(name: string, html = page()): Promise<Fixture> {
    const fixture = await createFixture(name);
    await fixture.write(`${DIR}/index.html`, html);
    const result = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"]);
    expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
    return fixture;
}

async function claudeSession(): Promise<FakeClaude> {
    const host = await startFakeClaude(randomUUID());
    closers.push(() => host.stop());
    return host;
}

type InboxJson = Array<{kind: string; artifactId?: string; artifactTitle?: string | null; questionId?: string; askedBy?: string | null}>;

async function inbox(fixture: Fixture): Promise<InboxJson> {
    const status = await fixture.cli(["status", "--json"]);
    expect(status.exitCode).toBe(0);
    return data<{inbox: InboxJson}>(status.json).inbox.filter((item) => item.kind === "question");
}

/** 起一个挂着 `answers --wait` 的命令行子进程，等它在 stderr 报“等待中”才返回。 */
async function startWaiter(fixture: Fixture, args: string[]): Promise<{child: ReturnType<typeof spawn>; result: Promise<{exitCode: number | null; stdout: string; stderr: string}>}> {
    const child = spawn(process.execPath, [CLI_PATH, "answers", ...args, "--wait", "--json"], {cwd: fixture.main, env: process.env, stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
    });
    const waiting = new Promise<void>((resolveWaiting, rejectWaiting) => {
        child.stderr!.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
            if (stderr.includes("等待中")) resolveWaiting();
        });
        child.once("exit", () => rejectWaiting(new Error(`等待的命令提前退出了：${stderr}`)));
    });
    const result = once(child, "exit").then(([code]) => ({exitCode: code as number | null, stdout, stderr}));
    closers.push(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
            await once(child, "exit");
        }
    });
    await waiting;
    return {child, result};
}

describe("产物与答复的命令（场景）", () => {
    test("场景 1：Claude 会话发布评审板拷贝：题与页面一致，提问者是这个会话的租约", async () => {
        const fixture = await createFixture("cli-publish-claude");
        const board = (await readFile(BOARD, "utf8"))
            .replace('<section class="q" id="r3-home">\n        <h2><span class="badge success">', '<section class="q" id="r3-home" data-nbdev-question="home-layout" data-nbdev-type="single">\n        <h2><span class="badge success" data-nbdev-skip>')
            .replace('<div class="cand"><a class="pv" href="r3/home.html#A">', '<div class="cand" data-nbdev-option="cards"><a class="pv" href="r3/home.html#A">')
            .replace('<div class="cand"><a class="pv" href="r3/home.html#B">', '<div class="cand" data-nbdev-option="table"><a class="pv" href="r3/home.html#B">')
            .replace('<section class="q" id="r2-docs">\n        <h2><span class="badge', '<section class="q" id="r2-docs" data-nbdev-question="docs-tree" data-nbdev-type="confirm">\n        <h2><span data-nbdev-skip class="badge');
        await fixture.write(`${DIR}/index.html`, board);
        const claude = await claudeSession();
        const result = await claude.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--json"], fixture.main);
        expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
        const published = data<{version: number; questions: Array<{id: string; type: string; options: Array<{value: string}>}>; lease: {leaseId: string; session: {key: string}}; waitCommand: string | null}>(result.json);
        expect([published.version, published.questions.map((question) => [question.id, question.type, question.options.map((option) => option.value)])]).toEqual([1, [["home-layout", "single", ["cards", "table"]], ["docs-tree", "confirm", []]]]);
        // 有活的题时给出等答复的命令（t19）。
        expect(published.waitCommand).toBe("nbdev answers w00001 t01 review --wait");
        expect(published.lease.session.key).toBe(`claude:${claude.sessionId}`);
        expect(await askerOf(fixture.main, REF, "docs-tree")).toMatchObject({leaseId: published.lease.leaseId, session: {key: `claude:${claude.sessionId}`}});
        expect((await inbox(fixture)).map((item) => [item.questionId, item.artifactTitle, item.askedBy])).toEqual([["docs-tree", "开发面板评审板", `claude:${claude.sessionId}`], ["home-layout", "开发面板评审板", `claude:${claude.sessionId}`]]);
    });

    test("场景 2：答了一道题后换掉另一道的题号：旧题号被取代，已答的题标针对 v1，收件箱不算被取代的题", async () => {
        const fixture = await published("cli-renumber");
        expect((await fixture.cli(["answers", "record", "w00001", "t01", "review", "--set", "approve=yes", "--as", "bob", "--json"])).exitCode).toBe(0);
        await fixture.write(`${DIR}/index.html`, page("layout-v2"));
        const v2 = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--as", "bob", "--json"]);
        expect([v2.exitCode, data<{dropped: string[]}>(v2.json).dropped]).toEqual([0, ["layout"]]);
        const answers = await fixture.cli(["answers", "w00001", "t01", "review", "--json"]);
        const view = data<{artifacts: Array<{version: number; questions: Array<{question: {id: string}; state: string; answer: {value: unknown; artifactVersion: number} | null}>}>}>(answers.json).artifacts[0]!;
        expect([view.version, view.questions.map((state) => [state.question.id, state.state, state.answer?.artifactVersion ?? null])]).toEqual([2, [["layout", "superseded", null], ["approve", "answered", 1], ["layout-v2", "open", null]]]);
        expect((await inbox(fixture)).map((item) => item.questionId)).toEqual(["layout-v2"]);
        const pending = await fixture.cli(["answers", "--pending", "--json"]);
        expect(data<{artifacts: Array<{questions: Array<{question: {id: string}}>}>}>(pending.json).artifacts.map((artifact) => artifact.questions.map((state) => state.question.id))).toEqual([["layout-v2"]]);
    });

    test("场景 3：ask 登记的题进收件箱，ask withdraw 之后消失；选答题不进收件箱", async () => {
        const fixture = await createFixture("cli-ask");
        const asked = await fixture.cli(["ask", "w00001", "t01", "--id", "migrate-order", "--type", "text", "--label", "迁移顺序怎么排", "--as", "bob", "--json"]);
        expect([asked.exitCode, data<{artifactId: string; version: number}>(asked.json)]).toEqual([0, expect.objectContaining({artifactId: "questions", version: 1, waitCommand: "nbdev answers w00001 t01 questions --wait"})]);
        expect((await inbox(fixture)).map((item) => [item.artifactId, item.questionId, item.askedBy])).toEqual([["questions", "migrate-order", "external:bob"]]);
        expect((await fixture.cli(["ask", "withdraw", "w00001", "t01", "migrate-order", "--as", "bob", "--json"])).exitCode).toBe(0);
        expect(await inbox(fixture)).toEqual([]);
        const fromFile = join(fixture.root, "questions.json");
        await writeFile(fromFile, JSON.stringify({questions: [{id: "pick", type: "single", label: "选一个", options: "a:甲|b:乙", recommend: "a"}, {id: "ok", type: "confirm", label: "同意吗", required: false}]}));
        const batch = await fixture.cli(["ask", "w00001", "t01", "--from", fromFile, "--as", "bob", "--json"]);
        expect([batch.exitCode, data<{affected: string[]}>(batch.json).affected]).toEqual([0, ["pick", "ok"]]);
        // 选答题（ok）不进收件箱。
        expect((await inbox(fixture)).map((item) => item.questionId)).toEqual(["pick"]);
        expect((await fixture.cli(["ask", "w00001", "t01", "--from", fromFile, "--id", "x", "--json"])).exitCode).toBe(2);
    });

    test("场景 4：挂着的 --wait 在答复写入并提交后几秒内退出并带回答复；超时、被打断都是退出码 4；--since 只等新的", async () => {
        const fixture = await published("cli-wait");
        const context = await locateRepository(fixture.main);
        const waiter = await startWaiter(fixture, ["w00001", "t01", "review", "--timeout", "60"]);
        const written = Date.now();
        const answered = await submitAnswer(context, {...REF, workRef: "w00001", taskRef: "t01", values: {layout: "cards"}, submittedBy: {kind: "developer", device: "test"}});
        expect(answered.commit.committed).toBe(true);
        const result = await waiter.result;
        expect(Date.now() - written).toBeLessThan(5_000);
        const envelope = JSON.parse(result.stdout) as CliEnvelope;
        expect([result.exitCode, data<{artifacts: Array<{unacked: string[]}>}>(envelope).artifacts[0]?.unacked]).toEqual([0, [answered.data.answer.answerId]]);

        // 已有未确认的答复：立即返回，不等。
        const immediate = await fixture.cli(["answers", "w00001", "t01", "review", "--wait", "--timeout", "60", "--json"]);
        expect([immediate.exitCode, data<{cursor: string}>(immediate.json).cursor]).toEqual([0, answered.data.answer.answerId]);
        const timedOut = await fixture.cli(["answers", "w00001", "t01", "review", "--wait", "--since", answered.data.answer.answerId, "--timeout", "1", "--json"]);
        expect([timedOut.exitCode, timedOut.json?.errors[0]?.code]).toEqual([4, "wait_timeout"]);
        // SIGHUP 是挂着它的终端或会话关掉时收到的，与 SIGTERM 一样要带回外壳。
        for (const signal of ["SIGTERM", "SIGHUP"] as const) {
            const interrupted = await startWaiter(fixture, ["w00001", "t01", "review", "--since", answered.data.answer.answerId, "--timeout", "60"]);
            interrupted.child.kill(signal);
            const stopped = await interrupted.result;
            expect([signal, stopped.exitCode, (JSON.parse(stopped.stdout) as CliEnvelope).errors[0]?.code]).toEqual([signal, 4, "wait_interrupted"]);
        }
        expect((await fixture.cli(["answers", "--wait", "--pending", "--json"])).exitCode).toBe(2);
        expect((await fixture.cli(["answers", "w00099", "--json"])).json?.errors[0]?.code).toBe("work_not_found");
    }, 60_000);

    test("先 --wait 后 ask：范围为空照常等并给警告，等待期间建出的 Task 提问集有了答复也能叫醒它", async () => {
        const fixture = await createFixture("cli-wait-empty");
        const context = await locateRepository(fixture.main);
        // 不带 --as：认不出调用者，caller_unknown 只给一次。
        const waiter = await startWaiter(fixture, ["w00001", "t01", "--timeout", "60"]);
        const asked = await fixture.cli(["ask", "w00001", "t01", "--id", "migrate-order", "--type", "text", "--label", "迁移顺序怎么排", "--as", "bob", "--json"]);
        expect(asked.exitCode).toBe(0);
        const answered = await submitAnswer(context, {workRef: "w00001", taskRef: "t01", artifactId: "questions", values: {"migrate-order": "先迁记录"}, submittedBy: {kind: "developer", device: "test"}});
        expect(answered.commit.committed).toBe(true);
        const result = await waiter.result;
        const envelope = JSON.parse(result.stdout) as CliEnvelope;
        expect(result.stderr).toContain("范围里还没有产物");
        expect([result.exitCode, data<{artifacts: Array<{artifactId: string; unacked: string[]}>}>(envelope).artifacts.map((view) => [view.artifactId, view.unacked]), envelope.warnings.map((warning) => warning.code)])
            .toEqual([0, [["questions", [answered.data.answer.answerId]]], ["caller_unknown", "wait_scope_empty"]]);
    }, 60_000);

    test("场景 5：answers ack --through <cursor> --include README：确认与 README 同一个提交；之后 --unacked 不再返回它", async () => {
        const fixture = await published("cli-ack");
        expect((await fixture.cli(["answers", "record", "w00001", "t01", "review", "--set", "layout=table", "--comment", "layout=表更紧凑", "--as", "bob", "--json"])).exitCode).toBe(0);
        const cursor = data<{cursor: string}>((await fixture.cli(["answers", "w00001", "t01", "review", "--json"])).json).cursor;
        await fixture.write(`${TASK_DIR}/README.md`, `${taskReadme("t01-seed")}\n## 决定\n\n1. 用表。\n`);
        const acked = await fixture.cli(["answers", "ack", "w00001", "t01", "review", "--through", cursor, "--include", `${TASK_DIR}/README.md`, "--as", "bob", "--json"]);
        expect([acked.exitCode, acked.json?.warnings]).toEqual([0, []]);
        const sha = data<{commit: {sha: string}}>(acked.json).commit.sha;
        const paths = (await git(fixture.main, "diff-tree", "--no-commit-id", "--name-only", "-r", sha)).split("\n").sort();
        expect(paths).toEqual([data<{path: string}>(acked.json).path, `${TASK_DIR}/README.md`].sort());
        expect(data<{artifacts: unknown[]}>((await fixture.cli(["answers", "--unacked", "--json"])).json).artifacts).toEqual([]);
    });

    test("关闭与重新打开：关闭撤回未答的题、收件箱清空；关闭后 ask 报 artifact_closed；重新发布恢复因关闭而撤回的题（含 ask 登记的），恢复的题能答", async () => {
        const fixture = await published("cli-close-reopen");
        expect((await fixture.cli(["answers", "record", "w00001", "t01", "review", "--set", "layout=cards", "--as", "bob", "--json"])).exitCode).toBe(0);
        expect((await fixture.cli(["ask", "w00001", "t01", "--artifact", "review", "--id", "extra", "--type", "text", "--label", "补一句", "--as", "bob", "--json"])).exitCode).toBe(0);
        const closed = await fixture.cli(["artifact", "close", "w00001", "t01", "review", "--as", "bob", "--json"]);
        expect([closed.exitCode, data<{version: number; affected: string[]}>(closed.json)]).toEqual([0, expect.objectContaining({version: 3, affected: ["approve", "extra"]})]);
        expect(await inbox(fixture)).toEqual([]);
        const late = await fixture.cli(["ask", "w00001", "t01", "--artifact", "review", "--id", "late", "--type", "text", "--label", "晚到", "--as", "bob", "--json"]);
        expect([late.exitCode, late.json?.errors[0]?.code]).toEqual([3, "artifact_closed"]);
        const reopened = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--as", "bob", "--json"]);
        expect([reopened.exitCode, data<{restored: string[]}>(reopened.json).restored, reopened.json?.warnings.map((warning) => warning.code)]).toEqual([0, ["approve", "extra"], ["artifact_reopened"]]);
        expect((await inbox(fixture)).map((item) => item.questionId).sort()).toEqual(["approve", "extra"]);
        expect((await fixture.cli(["answers", "record", "w00001", "t01", "review", "--set", "extra=好", "--as", "bob", "--json"])).exitCode).toBe(0);
    });

    test("命令行参数在边界校验：--since 要是答复 id；--set、--comment 的题号合格式、不重复；--by 的产物 id 合格式", async () => {
        const fixture = await published("cli-arguments");
        const codeOf = async (args: string[]) => {
            const result = await fixture.cli([...args, "--as", "bob", "--json"]);
            return [result.exitCode, result.json?.errors[0]?.code];
        };
        expect(await codeOf(["answers", "w00001", "t01", "review", "--since", "zzz"])).toEqual([2, "usage"]);
        expect(await codeOf(["answers", "w00001", "t01", "review", "--since", "zzz", "--wait", "--timeout", "1"])).toEqual([2, "usage"]);
        expect(await codeOf(["answers", "record", "w00001", "t01", "review", "--set", "__proto__=x"])).toEqual([2, "usage"]);
        expect(await codeOf(["answers", "record", "w00001", "t01", "review", "--set", "layout=cards", "--set", "layout=table"])).toEqual([2, "usage"]);
        expect(await codeOf(["answers", "record", "w00001", "t01", "review", "--set", "layout=cards", "--comment", "Bad=x"])).toEqual([2, "usage"]);
        expect(await codeOf(["ask", "supersede", "w00001", "t01", "review#layout", "--by", "..#q"])).toEqual([2, "invalid_artifact_id"]);
        expect((await readArtifact(fixture.main, REF)).answers).toEqual([]);
    });

    test("场景 6：引用 800 KB 的 PNG：发布成功，带体积警告", async () => {
        const fixture = await createFixture("cli-image");
        await fixture.write(`${DIR}/index.html`, `${page()}\n<img src="shot.png">`);
        await writeFile(join(fixture.main, DIR, "shot.png"), randomBytes(800 * 1024));
        const result = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"]);
        expect([result.exitCode, result.json?.warnings.map((warning) => warning.code)]).toEqual([0, ["image_too_large"]]);
    });

    test("文件集：只提交页面引用到的文件（img、CSS 的 url()、script src 与它 import 的模块、链接的子页）与 --include 列出的及其引用；未引用的截图不提交、给警告", async () => {
        const fixture = await createFixture("cli-file-set");
        // 已跟踪的文件（例如手动提交过的）即使没被引用也在文件集里：不会从哈希里掉出去，也不报未引用。
        await fixture.write(`${DIR}/legacy.txt`, "早先手动提交的\n");
        await fixture.commit("legacy file");
        await fixture.write(`${DIR}/index.html`, [page(), '<link rel="stylesheet" href="style.css"><script type="module" src="app.js"></script>', '<img src="assets/pic.png"><a href="r1/index.html">第一轮</a>'].join("\n"));
        await fixture.write(`${DIR}/style.css`, '@font-face { font-family: f; src: url("fonts/f.woff2") }');
        await fixture.write(`${DIR}/fonts/f.woff2`, "字体");
        await fixture.write(`${DIR}/app.js`, 'import {x} from "./lib/util.mjs";\nconsole.log(x);\n');
        await fixture.write(`${DIR}/lib/util.mjs`, "export const x = 1;\n");
        await fixture.write(`${DIR}/assets/pic.png`, "图");
        await fixture.write(`${DIR}/r1/index.html`, '<!doctype html><title>第一轮</title><section data-nbdev-question="r1-ok" data-nbdev-type="confirm"><h2>第一轮可以吗</h2></section>');
        await fixture.write(`${DIR}/data.json`, "{}\n");
        await fixture.write(`${DIR}/extra.css`, ".x { background: url(fonts/extra.woff2) }");
        await fixture.write(`${DIR}/fonts/extra.woff2`, "另一个字体");
        await fixture.write(`${DIR}/shot.png`, "检查页面时的截图");
        const first = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--include", "data.json", "--include", "extra.css", "--as", "bob", "--json"]);
        expect([first.exitCode, first.json?.warnings.map((warning) => [warning.code, warning.details?.paths])]).toEqual([0, [["unreferenced_files_not_committed", [`${DIR}/shot.png`]]]]);
        const inArtifact = ["app.js", "assets/pic.png", "data.json", "extra.css", "fonts/extra.woff2", "fonts/f.woff2", "index.html", "lib/util.mjs", "r1/index.html", "style.css"];
        expect(await committed(fixture, first)).toEqual([...inArtifact.map((path) => `${DIR}/${path}`), `${DIR}/versions/v1.json`].sort());
        expect((await readArtifact(fixture.main, REF)).latest?.files).toEqual([...inArtifact.slice(0, 7), "legacy.txt", ...inArtifact.slice(7)]);
        expect(data<{questions: Array<{id: string}>}>(first.json).questions.map((question) => question.id)).toEqual(["layout", "approve", "r1-ok"]);

        // 入口改为只链接 r2：仍被跟踪的 r1 是种子，它新加的图片照样追进来，它的题不被取代。
        await fixture.write(`${DIR}/index.html`, [page(), '<link rel="stylesheet" href="style.css"><script type="module" src="app.js"></script>', '<img src="assets/pic.png"><a href="r2/index.html">第二轮</a>'].join("\n"));
        await fixture.write(`${DIR}/r2/index.html`, "<!doctype html><title>第二轮</title><p>第二轮</p>");
        await fixture.write(`${DIR}/r1/index.html`, '<!doctype html><title>第一轮</title><section data-nbdev-question="r1-ok" data-nbdev-type="confirm"><h2>第一轮可以吗</h2><img src="new.webp"></section>');
        await fixture.write(`${DIR}/r1/new.webp`, "新图");
        const second = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--as", "bob", "--json"]);
        expect([second.exitCode, data<{dropped: string[]}>(second.json).dropped, second.json?.warnings.map((warning) => warning.code)]).toEqual([0, [], ["unreferenced_files_not_committed"]]);
        expect(await committed(fixture, second)).toEqual([`${DIR}/index.html`, `${DIR}/r1/index.html`, `${DIR}/r1/new.webp`, `${DIR}/r2/index.html`, `${DIR}/versions/v2.json`]);

        // 只多出没被引用的未跟踪文件：哈希不变，不出新版本。
        await fixture.write(`${DIR}/notes.txt`, "草稿\n");
        const third = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--as", "bob", "--json"]);
        expect([third.exitCode, data<{unchanged: boolean}>(third.json).unchanged, third.json?.warnings.map((warning) => warning.details?.paths)]).toEqual([0, true, [[`${DIR}/notes.txt`, `${DIR}/shot.png`]]]);
    });

    test("srcset 按候选语法解析：含逗号的路径与 data: 地址不被切开、不出伪引用；百分号编码加查询串的路径照样提交", async () => {
        const fixture = await createFixture("cli-srcset");
        await fixture.write(`${DIR}/index.html`, `${page()}\n<img srcset="assets/a,b.png 1x, data:image/png;base64,iVBOR,AAA 2x" src="%E5%9B%BE.png?size=1#top">`);
        await fixture.write(`${DIR}/assets/a,b.png`, "含逗号");
        await fixture.write(`${DIR}/图.png`, "中文名");
        const result = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"]);
        expect([result.exitCode, result.json?.warnings]).toEqual([0, []]);
        expect(await committed(fixture, result)).toEqual([`${DIR}/assets/a,b.png`, `${DIR}/index.html`, `${DIR}/versions/v1.json`, `${DIR}/图.png`]);
    });

    test("文件集按词法找引用：注释与字符串里写的地址不提交；带注释的 import、按转义解码的 CSS 地址、template 与 noscript 里的资源提交", async () => {
        const fixture = await createFixture("cli-file-set-lexing");
        await fixture.write(`${DIR}/index.html`, [
            page(),
            '<link rel="stylesheet" href="style.css"><script type="module" src="app.js"></script>',
            '<template id="card"><img src="card.png"></template><noscript><img src="noscript.png"></noscript>',
        ].join("\n"));
        await fixture.write(`${DIR}/app.js`, ['// import "./shot.png";', 'const sample = `import "./notes.txt"`;', 'import /* webpackChunkName: "real" */ "./lib.js";'].join("\n"));
        await fixture.write(`${DIR}/lib.js`, "export const x = 1;\n");
        await fixture.write(`${DIR}/style.css`, ['.a::before {content:"/*";}', ".a {background:url(real.png)}", '.b::before {content:"*/";}', ".c {background:url(pic\\ name.png)}"].join("\n"));
        for (const path of ["shot.png", "notes.txt", "real.png", "pic name.png", "card.png", "noscript.png"]) await fixture.write(`${DIR}/${path}`, path);
        const result = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"]);
        expect([result.exitCode, result.json?.warnings.map((warning) => [warning.code, warning.details?.paths])]).toEqual([0, [["unreferenced_files_not_committed", [`${DIR}/notes.txt`, `${DIR}/shot.png`]]]]);
        const inArtifact = ["app.js", "card.png", "index.html", "lib.js", "noscript.png", "pic name.png", "real.png", "style.css", "versions/v1.json"];
        expect(await committed(fixture, result)).toEqual(inArtifact.map((path) => `${DIR}/${path}`).sort());
    });

    test("找引用的扫描对文件长度是线性的：4 万行 url() 加一个没有右括号的 url( 的样式表照常很快发布完", async () => {
        const fixture = await createFixture("cli-file-set-large-css");
        await fixture.write(`${DIR}/index.html`, `${page()}\n<link rel="stylesheet" href="style.css">`);
        await fixture.write(`${DIR}/style.css`, `${".x { background: url(data:,x) }\n".repeat(40_000)}.y { background: url(${" ".repeat(128_000)}`);
        const started = Date.now();
        const result = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"]);
        expect([result.exitCode, result.json?.errors]).toEqual([0, []]);
        // 线性扫描在这份输入上不到一秒，平方级的要十几秒；5 秒的上限只为抓住后者，不衡量快慢。
        expect(Date.now() - started).toBeLessThan(5_000);
    }, 60_000);

    test("--include 指向不存在、被 Git 忽略或产物目录之外的文件：报 usage，不写发布记录", async () => {
        const fixture = await createFixture("cli-include-usage");
        await fixture.write(`${DIR}/index.html`, page());
        await fixture.write(`${DIR}/.gitignore`, "*.log\n");
        await fixture.write(`${DIR}/debug.log`, "忽略");
        for (const include of ["nope.json", "debug.log", "../README.md", "versions/v1.json"]) {
            const result = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--include", include, "--as", "bob", "--json"]);
            expect([include, result.exitCode, result.json?.errors[0]?.code]).toEqual([include, 2, "usage"]);
        }
        expect((await readArtifact(fixture.main, REF)).versions).toEqual([]);
        expect(await git(fixture.main, "log", "--format=%s")).toBe("seed");
    });

    test("不带 --json：错误、警告那一行之后逐条列出题的位置、未提交的文件与缺失、越界的引用，超过 20 条只列 20 条", async () => {
        const fixture = await createFixture("cli-details");
        /** stderr 里 `<label> [<code>]` 那一行之后、缩进两格的明细。 */
        const detailsOf = (stderr: string, label: string, code: string): string[] => {
            const lines = stderr.split("\n");
            const start = lines.findIndex((line) => line.startsWith(`${label} [${code}]`));
            expect([code, start >= 0]).toEqual([code, true]);
            const rest = lines.slice(start + 1);
            const end = rest.findIndex((line) => !line.startsWith("  "));
            return end === -1 ? rest : rest.slice(0, end);
        };
        const gone = Array.from({length: 22}, (_, index) => `<img src="gone-${index}.png">`);
        await fixture.write(`${DIR}/index.html`, [page(), '<img src="../outside.png">', ...gone].join("\n"));
        await fixture.write(`${DIR}/shot.png`, "截图");
        const warned = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob"]);
        expect(warned.exitCode).toBe(0);
        expect(detailsOf(warned.stderr, "警告", "unreferenced_files_not_committed")).toEqual([`  ${DIR}/shot.png`]);
        expect(detailsOf(warned.stderr, "警告", "reference_outside_artifact")).toEqual(["  index.html:5 ../outside.png"]);
        expect(detailsOf(warned.stderr, "警告", "missing_reference")).toEqual([...gone.slice(0, 20).map((_, index) => `  index.html:${6 + index} gone-${index}.png`), "  另有 2 条，加 --json 看全部"]);

        await fixture.write(`${DIR}/index.html`, [page(), '<section data-nbdev-question="Bad_Id" data-nbdev-type="confirm"><h2>坏题号</h2></section>'].join("\n"));
        // 原因的措辞不断言：只看位置、题号与括号里的错误码。
        const failed = await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--as", "bob"]);
        expect([failed.exitCode, detailsOf(failed.stderr, "错误", "invalid_questions")]).toEqual([2, [expect.stringMatching(/^ {2}index\.html:5:1 .*Bad_Id.* \[invalid_question_id\]$/u)]]);
        const asked = await fixture.cli(["ask", "w00001", "t01", "--id", "pick", "--type", "single", "--label", "选一个", "--as", "bob"]);
        expect([asked.exitCode, detailsOf(asked.stderr, "错误", "invalid_questions")]).toEqual([2, [expect.stringMatching(/^ {2}.*pick.* \[options_missing\]$/u)]]);
    });

    test("场景 7：两个进程同时发布同一个产物：版本号不重复，两次都提交了", async () => {
        const fixture = await createFixture("cli-concurrent-publish");
        await fixture.write(`${DIR}/index.html`, page());
        const [first, second] = await Promise.all(["甲", "乙"].map((title) => fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--title", title, "--as", "bob", "--json"])));
        expect([first!.exitCode, second!.exitCode]).toEqual([0, 0]);
        expect([data<{version: number}>(first!.json).version, data<{version: number}>(second!.json).version].sort()).toEqual([1, 2]);
        expect((await readdir(join(fixture.main, DIR, "versions"))).sort()).toEqual(["v1.json", "v2.json"]);
        expect(await git(fixture.main, "status", "--porcelain", "--", DIR)).toBe("");
    });

    test("场景 8 与最近更新：status 列出 Task 与 Work 目录里的 Markdown；Task 的最近更新取 updated、Task 目录第一层文档与产物提交日期中最晚的，updated 不合规时原样给出", async () => {
        const fixture = await createFixture("cli-documents");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", taskReadme("t01-seed", "updated: 2026-01-01\n"));
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/requirements.md", "# 需求分析\n");
        await fixture.write(".agents/works/w00001-seed/tasks/t03-design/README.md", taskReadme("t03-design"));
        await fixture.write(".agents/works/w00001-seed/tasks/t03-design/domain-model.md", "# 领域模型\n");
        await fixture.write(".agents/works/w00001-seed/pending.md", "# 待确认清单\n");
        await fixture.write(`${DIR}/index.html`, page());
        await fixture.commit("docs and board");
        const before = await fixture.cli(["status", "--json"]);
        type Works = Array<{documents: Array<{path: string; title: string}>; tasks: Array<{taskId: string; updated: {value: string | null; origin: string; raw?: unknown}; documents: Array<{title: string}>; artifacts: Array<{artifactId: string; state: string}>}>}>;
        const work = data<{works: Works}>(before.json).works[0]!;
        expect(work.documents.map((document) => document.title)).toEqual(["待确认清单"]);
        expect(work.tasks.map((task) => [task.taskId, task.documents.map((document) => document.title), task.artifacts.map((artifact) => [artifact.artifactId, artifact.state])])).toEqual([
            ["t01-seed", ["需求分析"], [["review", "unpublished"]]],
            ["t03-design", ["领域模型"], []],
        ]);
        // requirements.md 是今天提交的，比 README 的 updated（2026-01-01）晚。
        const today = (await git(fixture.main, "log", "-1", "--format=%cI")).slice(0, 10);
        expect(work.tasks[0]!.updated).toEqual({value: today, origin: "commit"});
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", taskReadme("t01-seed", "updated: 2099-01-01\n"));
        await fixture.commit("future updated");
        expect(data<{works: Works}>((await fixture.cli(["status", "--json"])).json).works[0]!.tasks[0]!.updated).toEqual({value: "2099-01-01", origin: "recorded"});
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", taskReadme("t01-seed", "updated: 2026-01-01\n"));
        await fixture.commit("old updated");
        expect((await fixture.cli(["artifact", "publish", "w00001", "t01", "review", "--kind", "design", "--as", "bob", "--json"])).exitCode).toBe(0);
        const after = data<{works: Works}>((await fixture.cli(["status", "--json"])).json).works[0]!.tasks[0]!;
        expect(after.updated).toEqual({value: today, origin: "commit"});

        // 不合规的 updated 不被产物的提交日期盖掉。
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/README.md", taskReadme("t01-seed", "updated: someday\n"));
        await fixture.commit("bad updated");
        const invalid = data<{works: Works}>((await fixture.cli(["status", "--json"])).json).works[0]!.tasks[0]!;
        expect(invalid.updated).toEqual({value: null, origin: "invalid", raw: "someday"});
    });

    test("status 不加载 parse5、不写任何文件；发布路径才加载；Task 改成 done 时提醒还有没答的必答题", async () => {
        const fixture = await published("cli-status-light");
        const before = (await git(fixture.main, "status", "--porcelain", "--untracked-files=all", "--ignored")).split("\n").sort().join("\n");
        const light = await run(process.execPath, ["--preload", NO_PARSE5, CLI_PATH, "status", "--json"], fixture.main);
        expect([light.exitCode, light.stderr]).toEqual([0, ""]);
        expect((await git(fixture.main, "status", "--porcelain", "--untracked-files=all", "--ignored")).split("\n").sort().join("\n")).toBe(before);
        const heavy = await run(process.execPath, ["--preload", NO_PARSE5, CLI_PATH, "artifact", "publish", "w00001", "t01", "review", "--force-version", "--as", "bob", "--json"], fixture.main);
        expect([heavy.exitCode, heavy.stderr]).toEqual([1, expect.stringContaining("parse5 不该")]);
        const done = await fixture.cli(["task", "status", "w00001", "t01", "done", "--as", "bob", "--json"]);
        expect([done.exitCode, done.json?.warnings.map((warning) => warning.code)]).toEqual([0, ["open_questions"]]);
        expect((await readArtifact(fixture.main, REF)).latest?.questions.every((question) => question.outcome === null)).toBe(true);
    });
});
