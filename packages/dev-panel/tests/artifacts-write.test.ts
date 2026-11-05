import {afterEach, describe, expect, test} from "bun:test";
import {randomBytes} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {ackAnswers, askQuestions, closeArtifact, publishArtifact, readAnswers, submitAnswer, supersedeQuestion, withdrawQuestion, withdrawUnanswered, type ArtifactOpOptions} from "../src/core/artifact-ops.js";
import {answerPath, currentContentHash, readArtifact, unackedAnswers, versionPath, type ArtifactRef} from "../src/core/artifacts.js";
import type {SessionCaller} from "../src/core/identity.js";
import {askerOf} from "../src/core/provenance.js";
import {locateRepository, type RepoContext} from "../src/core/repo.js";
import {cleanupFixtures, createFixture, git, taskReadme, type Fixture} from "./git-fixture.js";

afterEach(async () => {
    await cleanupFixtures();
});

const TASK_DIR = ".agents/works/w00001-seed/tasks/t01-seed";
const DIR = `${TASK_DIR}/artifacts/review`;
const REF: ArtifactRef = {workId: "w00001-seed", taskId: "t01-seed", artifactId: "review"};
const BOARD = resolve(import.meta.dirname, "fixtures/t03-review/index.html");
const bob: SessionCaller = {kind: "session", ref: {key: "external:bob", agent: "external", sessionId: null, label: "bob", parentSessionId: null, nestedSessionId: null}, via: "as", process: null, herdr: null};
const asBob: ArtifactOpOptions = {caller: bob, herdr: null};
const TARGET = {workRef: "w00001", taskRef: "t01", artifactId: "review"};

/** 两道题的页面：`first` 是单选，`second` 是确认题；`ids` 可以换掉题号。 */
function page(ids: {first?: string; second?: string} = {}, extra = ""): string {
    return [
        "<!doctype html><title>评审板</title>",
        `<section data-nbdev-question="${ids.first ?? "layout"}" data-nbdev-type="single"><h2><span data-nbdev-skip>待定</span>版式</h2>`,
        '<div data-nbdev-option="cards"><h3>卡片</h3></div><div data-nbdev-option="table"><h3>表</h3></div></section>',
        `<section data-nbdev-question="${ids.second ?? "approve"}" data-nbdev-type="confirm"><h2>批准</h2></section>`,
        extra,
    ].join("\n");
}

async function setup(name: string): Promise<{fixture: Fixture; context: RepoContext}> {
    const fixture = await createFixture(name);
    return {fixture, context: await locateRepository(fixture.main)};
}

async function changedPaths(fixture: Fixture, sha: string): Promise<string[]> {
    return (await git(fixture.main, "diff-tree", "--no-commit-id", "--name-only", "-r", sha)).split("\n").filter(Boolean).sort();
}

describe("发布", () => {
    test("场景 1：评审板拷贝加两道题后发布：题与页面一致，发布记录里没有会话，provenance 记下提问者；提交只含产物目录", async () => {
        const {fixture, context} = await setup("publish-board");
        const board = (await readFile(BOARD, "utf8"))
            .replace('<section class="q" id="r3-home">\n        <h2><span class="badge success">', '<section class="q" id="r3-home" data-nbdev-question="home-layout" data-nbdev-type="single" data-nbdev-recommend="cards">\n        <h2><span class="badge success" data-nbdev-skip>')
            .replace('<div class="cand"><a class="pv" href="r3/home.html#A">', '<div class="cand" data-nbdev-option="cards"><a class="pv" href="r3/home.html#A">')
            .replace('<div class="cand"><a class="pv" href="r3/home.html#B">', '<div class="cand" data-nbdev-option="table"><a class="pv" href="r3/home.html#B">')
            .replace('<section class="q" id="r2-docs">\n        <h2><span class="badge', '<section class="q" id="r2-docs" data-nbdev-question="docs-tree" data-nbdev-type="confirm">\n        <h2><span data-nbdev-skip class="badge');
        await fixture.write(`${DIR}/index.html`, board);
        await git(fixture.main, "add", "--", `${TASK_DIR}/README.md`);
        await fixture.write(".agents/works/w00001-seed/README.md", "unrelated staged change\n");
        await git(fixture.main, "add", "--", ".agents/works/w00001-seed/README.md");

        const outcome = await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        expect(outcome.commit.committed).toBe(true);
        expect(outcome.data).toMatchObject({version: 1, unchanged: false, path: versionPath(REF, 1)});
        const record = JSON.parse(await readFile(join(fixture.main, versionPath(REF, 1)), "utf8"));
        expect(record.questions.map((question: {id: string; type: string; label: string; options: Array<{value: string}>}) => [question.id, question.type, question.label, question.options.map((option) => option.value)])).toEqual([
            ["home-layout", "single", "首页（Work 视角）：A 卡片还是 B 表", ["cards", "table"]],
            ["docs-tree", "confirm", "文档页：按类型的树与切换 checkout", []],
        ]);
        expect(JSON.stringify(record)).not.toMatch(/session|lease|bob/u);
        expect(await askerOf(fixture.main, REF, "home-layout")).toMatchObject({leaseId: outcome.data.lease?.leaseId, session: {key: "external:bob"}});
        if (!outcome.commit.committed) throw new Error("应已提交");
        expect(await changedPaths(fixture, outcome.commit.sha)).toEqual([`${DIR}/index.html`, versionPath(REF, 1)].sort());
        expect(await git(fixture.main, "diff", "--cached", "--name-only")).toBe(".agents/works/w00001-seed/README.md");
        expect(outcome.warnings.map((warning) => warning.code)).toContain("missing_reference");
    });

    test("内容没变不出新版本；--force-version 才出；title 缺省沿用上一版", async () => {
        const {fixture, context} = await setup("publish-unchanged");
        await fixture.write(`${DIR}/index.html`, page());
        await publishArtifact(context, {...TARGET, kind: "design", title: "自定标题"}, asBob);
        const again = await publishArtifact(context, TARGET, asBob);
        expect([again.data.unchanged, again.commit.committed]).toEqual([true, false]);
        const forced = await publishArtifact(context, {...TARGET, forceVersion: true}, asBob);
        expect([forced.data.version, forced.commit.committed]).toEqual([2, true]);
        expect((await readArtifact(fixture.main, REF)).latest?.title).toBe("自定标题");
    });

    test("输出里上一版的发布者按 provenance 核对过 sha256：上一版的发布记录被改写过就不报发布者", async () => {
        const {fixture, context} = await setup("publish-previous-by");
        await fixture.write(`${DIR}/index.html`, page());
        await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        await fixture.write(`${DIR}/index.html`, page({first: "layout-v2"}));
        expect((await publishArtifact(context, TARGET, asBob)).data.previous).toMatchObject({version: 1, publishedBy: "external:bob"});
        // 像是删掉后由别的会话重建的 v2：内容变了，provenance 还记着 bob。
        const v2 = join(fixture.main, versionPath(REF, 2));
        await writeFile(v2, `${(await readFile(v2, "utf8")).trimEnd()}\n\n`);
        await fixture.write(`${DIR}/index.html`, page({first: "layout-v3"}));
        const v3 = await publishArtifact(context, TARGET, asBob);
        expect([v3.data.version, v3.data.previous]).toEqual([3, expect.objectContaining({version: 2, publishedBy: null})]);
    });

    test("场景 2 与第 11 条：换题号后旧题被取代，已答的题从页面删掉仍算已答；旧答复标出针对哪一版", async () => {
        const {fixture, context} = await setup("publish-renumber");
        await fixture.write(`${DIR}/index.html`, page());
        await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        await submitAnswer(context, {...TARGET, values: {approve: true}, submittedBy: {kind: "agent-transcribed"}}, asBob);
        await fixture.write(`${DIR}/index.html`, page({first: "layout-v2"}).replace(/<section data-nbdev-question="approve"[\s\S]*?<\/section>/u, ""));
        const v2 = await publishArtifact(context, TARGET, asBob);
        expect([v2.data.dropped, v2.warnings.map((warning) => warning.code)]).toEqual([["layout"], ["questions_dropped"]]);
        const latest = (await readArtifact(fixture.main, REF)).latest!;
        expect(latest.questions.map((question) => [question.id, question.outcome?.kind ?? null, question.page, question.since])).toEqual([
            ["layout", "superseded", "index.html", 1],
            ["approve", null, null, 1],
            ["layout-v2", null, "index.html", 2],
        ]);
        // 留下来的 approve 是之前几版的题：只为答案查得到，不再收答复；这一版页面上的题照常能答。
        await expect(submitAnswer(context, {...TARGET, values: {approve: false}, submittedBy: {kind: "agent-transcribed"}}, asBob)).rejects.toMatchObject({code: "question_earlier", details: {questionId: "approve", since: 1}});
        await submitAnswer(context, {...TARGET, values: {"layout-v2": "cards"}, submittedBy: {kind: "agent-transcribed"}}, asBob);
        expect((await readArtifact(fixture.main, REF)).answers.map((answer) => Object.keys(answer.values))).toEqual([["approve"], ["layout-v2"]]);
    });

    test("关闭撤回未答的题；关闭后不能再 ask；重新发布打开它，恢复因关闭而撤回的题", async () => {
        const {fixture, context} = await setup("publish-close");
        await fixture.write(`${DIR}/index.html`, page());
        await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        await submitAnswer(context, {...TARGET, values: {layout: "cards"}, submittedBy: {kind: "agent-transcribed"}}, asBob);
        const closed = await closeArtifact(context, TARGET, asBob);
        expect([closed.data.version, closed.data.affected]).toEqual([2, ["approve"]]);
        await expect(askQuestions(context, {...TARGET, questions: [{id: "late", type: "text", label: "晚到"}]}, asBob)).rejects.toMatchObject({code: "artifact_closed"});
        expect((await closeArtifact(context, TARGET, asBob)).warnings.map((warning) => warning.code)).toEqual(["already_closed"]);
        const reopened = await publishArtifact(context, TARGET, asBob);
        expect([reopened.data.restored, reopened.warnings.map((warning) => warning.code)]).toEqual([["approve"], ["artifact_reopened"]]);
        expect((await readArtifact(fixture.main, REF)).latest?.state).toBe("open");
    });

    test("标记不合规整体拒绝并列出问题；Task README 没提交、或 Task 还在分支上维护时拒写；只在 master 上的 Task 可以发布", async () => {
        const {fixture, context} = await setup("publish-guards");
        await fixture.write(`${DIR}/index.html`, '<section data-nbdev-question="x" data-nbdev-type="single"><h2>缺选项</h2></section>');
        await expect(publishArtifact(context, {...TARGET, kind: "design"}, asBob)).rejects.toMatchObject({code: "invalid_questions", details: {problems: [expect.objectContaining({code: "options_missing", questionId: "x", line: 1})]}});
        await expect(publishArtifact(context, {...TARGET, artifactId: "questions", kind: "design"}, asBob)).rejects.toMatchObject({code: "invalid_artifact_id"});

        // 分支在 t02 之前分出、还在维护 t01；t02 之后才建在 master 上（像迁来的 t80）。
        const worktree = await fixture.addWorktree("w00001-line", "feat/w00001");
        await fixture.write(`${TASK_DIR}/README.md`, taskReadme("t01-seed", "status: active\n"), worktree);
        await fixture.commit("branch keeps t01", worktree);
        await fixture.write(".agents/works/w00001-seed/tasks/t02-draft/README.md", taskReadme("t02-draft"));
        await fixture.write(".agents/works/w00001-seed/tasks/t02-draft/artifacts/review/index.html", page());
        await expect(publishArtifact(context, {workRef: "w00001", taskRef: "t02", artifactId: "review", kind: "design"}, asBob)).rejects.toMatchObject({code: "task_not_committed"});
        await git(fixture.main, "add", "--", ".agents/works/w00001-seed/tasks/t02-draft/README.md");
        await git(fixture.main, "commit", "--quiet", "-m", "t02 on master", "--", ".agents/works/w00001-seed/tasks/t02-draft/README.md");
        await fixture.write(`${DIR}/index.html`, page());
        await expect(publishArtifact(context, {...TARGET, kind: "design"}, asBob)).rejects.toMatchObject({code: "branch_maintained_record"});
        const masterOnly = await publishArtifact(context, {workRef: "w00001", taskRef: "t02", artifactId: "review", kind: "design"}, asBob);
        expect([masterOnly.data.version, masterOnly.commit.committed]).toEqual([1, true]);
    });

    test("场景 6：800 KB 的图片照常发布并警告；Task 合计超过 5 MiB（含还没跟踪的新图）也警告；引用产物目录之外的给警告", async () => {
        const {fixture, context} = await setup("publish-images");
        await fixture.write(`${DIR}/index.html`, page({}, '<img src="big.png"><a href="../../README.md">记录</a><a href="index.html?x=1#top">自己</a>'));
        await writeFile(join(fixture.main, DIR, "big.png"), randomBytes(800 * 1024));
        for (let index = 0; index < 6; index += 1) {
            await fixture.write(`${TASK_DIR}/evidences/shot-${index}.png`, "");
            await writeFile(join(fixture.main, TASK_DIR, "evidences", `shot-${index}.png`), randomBytes(900 * 1024));
        }
        const outcome = await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        expect(outcome.commit.committed).toBe(true);
        expect(outcome.warnings.map((warning) => warning.code).sort()).toEqual(["image_too_large", "reference_outside_artifact", "task_images_too_large"]);
    });
});

describe("登记、撤回与取代", () => {
    test("场景 3 的写入：ask 建 Task 提问集；题号不复用；撤回与取代写进新版本，取代者存完整 id；提问集不能关闭", async () => {
        const {fixture, context} = await setup("ask-flow");
        const asked = await askQuestions(context, {workRef: "w00001", taskRef: "t01", questions: [{id: "migrate-order", type: "text", label: "迁移顺序", about: "docs/specs/x.md"}]}, asBob);
        expect([asked.data.artifactId, asked.data.version, asked.warnings.map((warning) => warning.code)]).toEqual(["questions", 1, ["about_not_found"]]);
        const set = (await readArtifact(fixture.main, {...REF, artifactId: "questions"})).latest!;
        expect([set.kind, set.entry, set.contentHash, set.questions[0]]).toEqual(["questions", null, null, expect.objectContaining({id: "migrate-order", origin: "ask", page: null, about: "docs/specs/x.md", since: 1, outcome: null})]);
        await expect(askQuestions(context, {workRef: "w00001", taskRef: "t01", questions: [{id: "migrate-order", type: "text", label: "又一次"}]}, asBob)).rejects.toMatchObject({code: "duplicate_question"});
        await askQuestions(context, {workRef: "w00001", taskRef: "t01", questions: [{id: "replacement", type: "confirm", label: "新的问法"}, {id: "drop-me", type: "text", label: "不要了"}]}, asBob);
        await withdrawQuestion(context, {workRef: "w00001", taskRef: "t01", question: "drop-me"}, asBob);
        await expect(withdrawQuestion(context, {workRef: "w00001", taskRef: "t01", question: "drop-me"}, asBob)).rejects.toMatchObject({code: "question_closed"});
        await supersedeQuestion(context, {workRef: "w00001", taskRef: "t01", question: "migrate-order", by: "w00001/t01/questions#replacement"}, asBob);
        const latest = (await readArtifact(fixture.main, {...REF, artifactId: "questions"})).latest!;
        expect(latest.questions.map((question) => [question.id, question.outcome])).toEqual([
            ["migrate-order", {kind: "superseded", in: 4, by: {workId: "w00001-seed", taskId: "t01-seed", artifactId: "questions", questionId: "replacement"}}],
            ["replacement", null],
            ["drop-me", {kind: "withdrawn", in: 3, reason: "explicit"}],
        ]);
        await expect(askQuestions(context, {workRef: "w00001", taskRef: "t01", questions: [{id: "Bad", type: "single", label: "x"}]}, asBob)).rejects.toMatchObject({code: "invalid_questions"});
        await expect(closeArtifact(context, {workRef: "w00001", taskRef: "t01", artifactId: "questions"}, asBob)).rejects.toMatchObject({code: "usage"});
        expect((await readArtifact(fixture.main, {...REF, artifactId: "questions"})).latest?.state).toBe("open");
    });

    test("提问集的“撤回没答的题”：ask 的题缺省选答；答过的留着，没答的一次撤回；再撤一次不出新版本", async () => {
        const fixture = await createFixture("write-withdraw-unanswered");
        const context = await locateRepository(fixture.main);
        const target = {workRef: "w00001", taskRef: "t01", artifactId: "questions"};
        await askQuestions(context, {workRef: "w00001", taskRef: "t01", questions: [{id: "answered", type: "text", label: "答了"}, {id: "skipped", type: "text", label: "不想答", required: true}]}, asBob);
        const ref = {...REF, artifactId: "questions"};
        expect((await readArtifact(fixture.main, ref)).latest?.questions.map((question) => question.required)).toEqual([false, true]);
        await submitAnswer(context, {...target, values: {answered: "好"}, submittedBy: {kind: "developer", device: "test"}});
        const withdrawn = await withdrawUnanswered(context, target, asBob);
        expect(withdrawn.data.affected).toEqual(["skipped"]);
        expect((await readArtifact(fixture.main, ref)).latest?.questions.map((question) => [question.id, question.outcome?.kind ?? null])).toEqual([["answered", null], ["skipped", "withdrawn"]]);
        expect((await withdrawUnanswered(context, target, asBob)).warnings.map((warning) => warning.code)).toEqual(["nothing_to_withdraw"]);
    });
});

describe("答复只能答活的题；每种写入只提交自己的路径", () => {
    test("已撤回、已取代、因关闭而撤回的题拒绝答复；ask、withdraw、supersede、close 的提交只含新的发布记录，无关的已暂存改动留在暂存区", async () => {
        const {fixture, context} = await setup("answers-live-only");
        await fixture.write(`${DIR}/index.html`, page());
        await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        await fixture.write(".agents/works/w00001-seed/README.md", "unrelated staged change\n");
        await git(fixture.main, "add", "--", ".agents/works/w00001-seed/README.md");
        const onlyVersion = async (outcome: {commit: {committed: boolean; sha?: string}; data: {path: string | null}}) => {
            if (!outcome.commit.committed || !outcome.commit.sha) throw new Error("应已提交");
            expect(await changedPaths(fixture, outcome.commit.sha)).toEqual([outcome.data.path!]);
        };
        await onlyVersion(await askQuestions(context, {...TARGET, questions: [{id: "pulled", type: "text", label: "撤回的题"}, {id: "replaced", type: "text", label: "被取代的题"}]}, asBob));
        await onlyVersion(await withdrawQuestion(context, {...TARGET, question: "review#pulled"}, asBob));
        await onlyVersion(await supersedeQuestion(context, {...TARGET, question: "review#replaced", by: "review#layout"}, asBob));
        const answer = (values: Record<string, unknown>) => submitAnswer(context, {...TARGET, values, submittedBy: {kind: "agent-transcribed"}}, asBob);
        await expect(answer({pulled: "晚了"})).rejects.toMatchObject({code: "question_closed", details: {questionId: "pulled", outcome: {kind: "withdrawn", reason: "explicit"}}});
        await expect(answer({replaced: "晚了"})).rejects.toMatchObject({code: "question_closed", details: {questionId: "replaced", outcome: {kind: "superseded"}}});
        await onlyVersion(await closeArtifact(context, TARGET, asBob));
        await expect(answer({approve: true})).rejects.toMatchObject({code: "question_closed", details: {questionId: "approve", outcome: {kind: "withdrawn", reason: "closed"}}});
        expect((await readArtifact(fixture.main, REF)).answers).toEqual([]);
        expect(await git(fixture.main, "diff", "--cached", "--name-only")).toBe(".agents/works/w00001-seed/README.md");
    });
});

describe("答复与确认", () => {
    test("取值按题的定义校验；确认覆盖当时未确认的全部答复，与 --include 的 README 同一个提交；没有新答复时不写", async () => {
        const {fixture, context} = await setup("answers-ack");
        await fixture.write(`${DIR}/index.html`, page());
        await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        await expect(submitAnswer(context, {...TARGET, values: {layout: "nope"}, submittedBy: {kind: "agent-transcribed"}}, asBob)).rejects.toMatchObject({code: "invalid_answer"});
        await expect(submitAnswer(context, {...TARGET, values: {ghost: true}, submittedBy: {kind: "agent-transcribed"}}, asBob)).rejects.toMatchObject({code: "question_not_found"});
        const answered = await submitAnswer(context, {...TARGET, values: {layout: "cards"}, comments: {layout: "卡片更清楚"}, submittedBy: {kind: "agent-transcribed"}}, asBob);
        if (!answered.commit.committed) throw new Error("应已提交");
        expect(await changedPaths(fixture, answered.commit.sha)).toEqual([answered.data.path]);
        expect(JSON.stringify(answered.data.answer)).not.toMatch(/session|bob/u);

        await fixture.write(`${TASK_DIR}/README.md`, `${taskReadme("t01-seed")}\n## 决定\n\n1. 用卡片。\n`);
        const acked = await ackAnswers(context, {...TARGET, include: [`${TASK_DIR}/README.md`]}, asBob);
        if (!acked.commit.committed) throw new Error("应已提交");
        expect(await changedPaths(fixture, acked.commit.sha)).toEqual([acked.data.path!, `${TASK_DIR}/README.md`].sort());
        expect(acked.data.ack?.answers).toEqual([answered.data.answer.answerId]);
        const again = await ackAnswers(context, TARGET, asBob);
        expect([again.data.acked, again.warnings.map((warning) => warning.code)]).toEqual([false, ["already_acked"]]);
        await expect(ackAnswers(context, {...TARGET, include: ["README.md"]}, asBob)).rejects.toMatchObject({code: "unsafe_path"});
    });

    test("旧答复作废的原因：选项后来改了记 stale_value；按它针对的那一版也不合法（手改坏的）记 invalid_value", async () => {
        const {fixture, context} = await setup("answers-stale");
        await fixture.write(`${DIR}/index.html`, page());
        await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        const cards = await submitAnswer(context, {...TARGET, values: {layout: "cards"}, submittedBy: {kind: "agent-transcribed"}}, asBob);
        await fixture.write(`${DIR}/index.html`, page().replace('data-nbdev-option="cards"><h3>卡片', 'data-nbdev-option="grid"><h3>网格'));
        expect((await publishArtifact(context, TARGET, asBob)).data.version).toBe(2);
        const layoutState = async () => (await readAnswers(context, {...TARGET, filter: "all"})).artifacts[0]!.questions.find((state) => state.question.id === "layout")!;
        expect(await layoutState()).toMatchObject({state: "open", stale: {answerId: cards.data.answer.answerId, artifactVersion: 1, code: "stale_value"}});
        const brokenId = "29991231T000000000Z-0badf00d";
        await fixture.write(answerPath(REF, brokenId), `${JSON.stringify({
            schema: "nbdev.answer/v1", ...REF, answerId: brokenId, artifactVersion: 1, contentHash: null, submittedAt: "2026-10-12T00:00:00.000Z",
            submittedBy: {kind: "agent-transcribed"}, values: {layout: "zzz"}, comments: {}, note: null,
        })}\n`);
        expect(await layoutState()).toMatchObject({state: "open", stale: {answerId: brokenId, code: "invalid_value"}});
    });

    test("--include 只收普通文件、不收被忽略的文件：写任何东西之前就拒绝，改对路径重跑照常确认", async () => {
        const {fixture, context} = await setup("answers-include");
        await fixture.write(`${DIR}/index.html`, page());
        await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        await submitAnswer(context, {...TARGET, values: {layout: "cards"}, submittedBy: {kind: "agent-transcribed"}}, asBob);
        await expect(ackAnswers(context, {...TARGET, include: [TASK_DIR]}, asBob)).rejects.toMatchObject({code: "usage", details: {reason: "not_file"}});
        await fixture.write(`${TASK_DIR}/scratch.md`, "草稿\n");
        await mkdir(join(fixture.main, ".git", "info"), {recursive: true});
        await writeFile(join(fixture.main, ".git", "info", "exclude"), "scratch.md\n");
        await expect(ackAnswers(context, {...TARGET, include: [`${TASK_DIR}/scratch.md`]}, asBob)).rejects.toMatchObject({code: "usage", details: {reason: "ignored", paths: [`${TASK_DIR}/scratch.md`]}});
        expect(await git(fixture.main, "status", "--porcelain", "--untracked-files=all", "--", DIR)).toBe("");
        await fixture.write(`${TASK_DIR}/README.md`, `${taskReadme("t01-seed")}\n## 决定\n\n1. 用卡片。\n`);
        const acked = await ackAnswers(context, {...TARGET, include: [`${TASK_DIR}/README.md`]}, asBob);
        if (!acked.commit.committed) throw new Error("应已提交");
        expect(await changedPaths(fixture, acked.commit.sha)).toEqual([acked.data.path!, `${TASK_DIR}/README.md`].sort());
    });

    test("ack --through 只确认会话读到的答复：读完之后才到的答复仍是未确认，并给 newer_answers_unacked", async () => {
        const {fixture, context} = await setup("answers-through");
        await fixture.write(`${DIR}/index.html`, page());
        await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        const seen = await submitAnswer(context, {...TARGET, values: {layout: "cards"}, submittedBy: {kind: "agent-transcribed"}}, asBob);
        const read = await readAnswers(context, {...TARGET, filter: "unacked"});
        expect(read.cursor).toBe(seen.data.answer.answerId);
        // 会话读完、还在写 README 的时候，开发者改了主意。
        const unseen = await submitAnswer(context, {...TARGET, values: {layout: "table", approve: false}, submittedBy: {kind: "developer", device: "test"}});
        const acked = await ackAnswers(context, {...TARGET, through: read.cursor!}, asBob);
        expect([acked.data.ack?.answers, acked.data.newer, acked.warnings.map((warning) => warning.code)]).toEqual([[seen.data.answer.answerId], [unseen.data.answer.answerId], ["newer_answers_unacked"]]);
        const snapshot = await readArtifact(fixture.main, REF);
        expect(unackedAnswers(snapshot.answers, snapshot.acks).map((answer) => answer.answerId)).toEqual([unseen.data.answer.answerId]);
        const again = await ackAnswers(context, {...TARGET, through: read.cursor!}, asBob);
        expect([again.data.acked, again.warnings.map((warning) => warning.code)]).toEqual([false, ["newer_answers_unacked", "already_acked"]]);
        const all = await ackAnswers(context, TARGET, asBob);
        expect([all.data.ack?.answers, all.warnings.map((warning) => warning.code)]).toEqual([[unseen.data.answer.answerId], ["ack_without_through"]]);
        await expect(ackAnswers(context, {...TARGET, through: "zzz"}, asBob)).rejects.toMatchObject({code: "usage"});
    });

    test("答复 id 用锁内重读的时钟：写事务锁前读的时钟（tx.now）早于别的产物刚落位的答复时，id 仍排在后面，跨产物的 --since 不漏", async () => {
        const {fixture, context} = await setup("answers-clock");
        await fixture.write(`${DIR}/index.html`, page());
        await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        await askQuestions(context, {workRef: "w00001", taskRef: "t01", questions: [{id: "note", type: "text", label: "补一句"}]}, asBob);
        const first = await submitAnswer(context, {...TARGET, values: {layout: "cards"}, submittedBy: {kind: "agent-transcribed"}}, asBob);
        // 这份答复的写事务“一分钟前就读了时钟”，一直等锁到现在才落位；它写在另一个产物里，同目录 +1 毫秒的规则帮不上忙。
        const late = await submitAnswer(context, {workRef: "w00001", taskRef: "t01", artifactId: "questions", values: {note: "后到"}, submittedBy: {kind: "agent-transcribed"}}, {...asBob, now: () => new Date(Date.now() - 60_000)});
        expect(late.data.answer.answerId > first.data.answer.answerId).toBe(true);
        const after = await readAnswers(context, {workRef: "w00001", taskRef: "t01", filter: "all", since: first.data.answer.answerId});
        expect(after.artifacts.map((view) => [view.artifactId, view.answers.map((entry) => entry.answerId)])).toEqual([["questions", [late.data.answer.answerId]]]);
    });
});

describe("提交失败之后的补救", () => {
    const README = `${TASK_DIR}/README.md`;
    /** 写事务只等 300 毫秒的 index.lock，占住它就能让这次提交以 git_lock_timeout 失败、文件留在主工作区。 */
    const blocked: ArtifactOpOptions = {...asBob, gitLockWaitMs: 300};

    async function holdIndexLock(fixture: Fixture): Promise<() => Promise<void>> {
        const indexLock = join(fixture.main, ".git", "index.lock");
        await writeFile(indexLock, "");
        return () => rm(indexLock, {force: true});
    }

    test("发布提交失败后重跑同一条发布：不出新版本，补交上次的发布记录（含已暂存未提交的）与页面", async () => {
        const {fixture, context} = await setup("residue-publish");
        await fixture.write(`${DIR}/index.html`, page());
        const release = await holdIndexLock(fixture);
        const failed = await publishArtifact(context, {...TARGET, kind: "design"}, blocked);
        expect(failed.commit).toMatchObject({committed: false, reason: "git_lock_timeout"});
        await release();
        // add 成功、commit 失败时残留是已暂存的新文件。
        await git(fixture.main, "add", "--", versionPath(REF, 1));
        const again = await publishArtifact(context, TARGET, asBob);
        const expected = [`${DIR}/index.html`, versionPath(REF, 1)].sort();
        expect([again.data.unchanged, [...again.data.committedFiles].sort(), again.warnings.map((warning) => warning.code)]).toEqual([true, expected, ["residual_records_committed"]]);
        if (!again.commit.committed) throw new Error("应已提交");
        expect(await changedPaths(fixture, again.commit.sha)).toEqual(expected);
        expect(await git(fixture.main, "status", "--porcelain", "--untracked-files=all", "--", DIR)).toBe("");
    });

    test("带 --include 的发布 git add 失败：面板按发布记录的 files 重算出同一个哈希；重跑原命令（不再列 --include）只补交、不出新版本，没被链接的有题页面上的题不被取代", async () => {
        const {fixture, context} = await setup("residue-include");
        await fixture.write(`${DIR}/index.html`, page());
        await fixture.write(`${DIR}/side.html`, '<!doctype html><title>旁页</title><section data-nbdev-question="side-q" data-nbdev-type="confirm"><h2>旁页的题</h2></section>');
        await fixture.write(`${DIR}/data.json`, "{}\n");
        const release = await holdIndexLock(fixture);
        const failed = await publishArtifact(context, {...TARGET, kind: "design", include: ["side.html", "data.json"]}, blocked);
        expect(failed.commit).toMatchObject({committed: false, reason: "git_lock_timeout"});
        await release();
        const latest = (await readArtifact(fixture.main, REF)).latest!;
        expect([latest.files, await currentContentHash(fixture.main, REF, latest)]).toEqual([["data.json", "index.html", "side.html"], latest.contentHash]);

        const again = await publishArtifact(context, TARGET, asBob);
        const expected = [`${DIR}/data.json`, `${DIR}/index.html`, `${DIR}/side.html`, versionPath(REF, 1)].sort();
        expect([again.data.unchanged, [...again.data.committedFiles].sort(), again.warnings.map((warning) => warning.code)]).toEqual([true, expected, ["residual_records_committed"]]);
        expect(again.data.questions.map((question) => [question.id, question.outcome])).toEqual([["layout", null], ["approve", null], ["side-q", null]]);
        if (!again.commit.committed) throw new Error("应已提交");
        expect(await changedPaths(fixture, again.commit.sha)).toEqual(expected);
    });

    test("旧格式（没有 files）的发布记录提交失败后重跑：没被跟踪、入口也没链接的有题页面靠题表找回，只补交、不出新版本，题不被取代", async () => {
        const {fixture, context} = await setup("residue-legacy-record");
        await fixture.write(`${DIR}/index.html`, page());
        await fixture.write(`${DIR}/side.html`, '<!doctype html><title>旁页</title><section data-nbdev-question="side-q" data-nbdev-type="confirm"><h2>旁页的题</h2></section>');
        const release = await holdIndexLock(fixture);
        const failed = await publishArtifact(context, {...TARGET, kind: "design", include: ["side.html"]}, blocked);
        expect(failed.commit).toMatchObject({committed: false, reason: "git_lock_timeout"});
        await release();
        // 加 files 之前的版本写的记录没有这个字段；那时整个目录都在文件集里，题表照样记着 side.html。
        const recordPath = join(fixture.main, versionPath(REF, 1));
        const {files: _files, ...legacy} = JSON.parse(await readFile(recordPath, "utf8")) as Record<string, unknown>;
        await writeFile(recordPath, `${JSON.stringify(legacy, null, 2)}\n`);

        const again = await publishArtifact(context, TARGET, asBob);
        const expected = [`${DIR}/index.html`, `${DIR}/side.html`, versionPath(REF, 1)].sort();
        expect([again.data.unchanged, [...again.data.committedFiles].sort(), again.data.questions.map((question) => [question.id, question.outcome])])
            .toEqual([true, expected, [["layout", null], ["approve", null], ["side-q", null]]]);
        if (!again.commit.committed) throw new Error("应已提交");
        expect(await changedPaths(fixture, again.commit.sha)).toEqual(expected);
    });

    test("代录提交失败：下一次确认把那份答复与确认、README 一起提交；确认提交失败：重跑同一条确认补交确认与 README", async () => {
        const {fixture, context} = await setup("residue-answers");
        await fixture.write(`${DIR}/index.html`, page());
        await publishArtifact(context, {...TARGET, kind: "design"}, asBob);
        let release = await holdIndexLock(fixture);
        const answered = await submitAnswer(context, {...TARGET, values: {layout: "cards"}, submittedBy: {kind: "agent-transcribed"}}, blocked);
        expect(answered.commit).toMatchObject({committed: false, reason: "git_lock_timeout"});
        await release();
        await fixture.write(README, `${taskReadme("t01-seed")}\n## 决定\n\n1. 用卡片。\n`);
        const acked = await ackAnswers(context, {...TARGET, through: answered.data.answer.answerId, include: [README]}, asBob);
        if (!acked.commit.committed) throw new Error("应已提交");
        expect(await changedPaths(fixture, acked.commit.sha)).toEqual([answered.data.path, acked.data.path!, README].sort());

        const second = await submitAnswer(context, {...TARGET, values: {approve: true}, submittedBy: {kind: "agent-transcribed"}}, asBob);
        await fixture.write(README, `${taskReadme("t01-seed")}\n## 决定\n\n1. 用卡片。\n2. 批准。\n`);
        release = await holdIndexLock(fixture);
        const failedAck = await ackAnswers(context, {...TARGET, through: second.data.answer.answerId, include: [README]}, blocked);
        expect(failedAck.commit).toMatchObject({committed: false, reason: "git_lock_timeout"});
        await release();
        const rerun = await ackAnswers(context, {...TARGET, through: second.data.answer.answerId, include: [README]}, asBob);
        expect([rerun.data.acked, rerun.warnings.map((warning) => warning.code)]).toEqual([false, ["residual_records_committed", "already_acked"]]);
        if (!rerun.commit.committed) throw new Error("应已提交");
        expect(await changedPaths(fixture, rerun.commit.sha)).toEqual([failedAck.data.path!, README].sort());
        expect(await git(fixture.main, "status", "--porcelain", "--untracked-files=all", "--", TASK_DIR)).toBe("");
    });
});
