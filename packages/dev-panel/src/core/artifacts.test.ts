import {afterEach, describe, expect, test} from "bun:test";
import {mkdir, rm, symlink, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {cleanupFixtures, createFixture} from "../../tests/git-fixture.js";
import {
    ackPath,
    adoptionOf,
    answerPath,
    answersAfter,
    artifactContentHash,
    artifactFileSet,
    closeQuestions,
    listArtifactFiles,
    listDocuments,
    nextQuestions,
    nextRecordId,
    questionStates,
    readArtifact,
    RECORD_ID_PATTERN,
    unackedAnswers,
    waitingStates,
    versionPath,
    type AckRecord,
    type AnswerRecord,
    type ArtifactRef,
    type ArtifactVersion,
    type VersionQuestion,
} from "./artifacts.js";
import type {LeaseRecord} from "./leases.js";
import {askerOf, verifiedProvenance, writeProvenance} from "./provenance.js";
import type {MarkupQuestion} from "./questions.js";

afterEach(async () => {
    await cleanupFixtures();
});

const REF: ArtifactRef = {workId: "w00001-seed", taskId: "t01-seed", artifactId: "review"};
const T0 = "2026-10-12T10:00:00.000Z";

function question(id: string, overrides: Partial<VersionQuestion> = {}): VersionQuestion {
    return {
        id, type: "single", label: `题 ${id}`, options: [{value: "a", label: "A"}, {value: "b", label: "B"}], required: true, recommend: [],
        origin: "markup", page: "index.html", about: null, since: 1, outcome: null, ...overrides,
    };
}

function markup(id: string, overrides: Partial<MarkupQuestion> = {}): MarkupQuestion {
    return {id, type: "single", label: `题 ${id}`, options: [{value: "a", label: "A"}, {value: "b", label: "B"}], required: true, recommend: [], page: "index.html", line: 1, ...overrides};
}

function version(number: number, questions: VersionQuestion[], overrides: Partial<ArtifactVersion> = {}): ArtifactVersion {
    return {
        schema: "nbdev.artifact-version/v1", ...REF, version: number, supersedes: number > 1 ? number - 1 : null, action: "publish",
        kind: "design", title: "评审板", state: "open", entry: "index.html", contentHash: "h", files: ["index.html"], questions, publishedAt: T0, ...overrides,
    };
}

function answer(answerId: string, values: Record<string, unknown>, overrides: Partial<AnswerRecord> = {}): AnswerRecord {
    return {
        schema: "nbdev.answer/v1", ...REF, answerId, artifactVersion: 1, contentHash: "h", submittedAt: T0,
        submittedBy: {kind: "agent-transcribed"}, values, comments: {}, note: null, ...overrides,
    };
}

function ack(ackId: string, answers: string[]): AckRecord {
    return {schema: "nbdev.answer-ack/v1", ...REF, ackId, answers, through: answers.at(-1) ?? "", included: [], ackedAt: T0};
}

const id = (time: string, suffix = "00000000") => `${time}-${suffix}`;

describe("新版本的题表（nextQuestions）", () => {
    test("活题沿用 since 换新定义；新题从本版算起；页面里没有了的未答题被取代，已答题保留、page 记 null", () => {
        const previous = version(1, [question("keep-me"), question("gone-open"), question("gone-answered"), question("asked", {origin: "ask", page: null})]);
        const result = nextQuestions({previous, markup: [markup("keep-me", {label: "改过的题目"}), markup("fresh")], version: 2, keep: [], answeredIds: new Set(["gone-answered"])});
        expect(result.questions.map((entry) => [entry.id, entry.since, entry.outcome, entry.page, entry.label])).toEqual([
            ["keep-me", 1, null, "index.html", "改过的题目"],
            ["gone-open", 1, {kind: "superseded", in: 2, by: null}, "index.html", "题 gone-open"],
            ["gone-answered", 1, null, null, "题 gone-answered"],
            ["asked", 1, null, null, "题 asked"],
            ["fresh", 2, null, "index.html", "题 fresh"],
        ]);
        expect([result.dropped, result.retiredInPage, result.restored, result.problems]).toEqual([["gone-open"], [], [], []]);
    });

    test("--keep 保留暂时删掉的题；不适用的 --keep 报出来（含之前几版的题）；与 ask 登记的题同号报 duplicate_question", () => {
        const previous = version(1, [question("temp"), question("asked", {origin: "ask", page: null}), question("earlier", {page: null})]);
        const result = nextQuestions({previous, markup: [markup("asked")], version: 2, keep: ["temp", "nope", "earlier"], answeredIds: new Set(["earlier"])});
        expect(result.questions.find((entry) => entry.id === "temp")?.outcome).toBeNull();
        expect(result.problems.map((problem) => [problem.code, problem.questionId])).toEqual([["duplicate_question", "asked"], ["keep_not_applicable", "nope"], ["keep_not_applicable", "earlier"]]);
    });

    test("已撤回或已取代的题号又出现在页面里：保持原结局，不复活", () => {
        const previous = version(2, [question("old", {outcome: {kind: "superseded", in: 2, by: null}}), question("pulled", {outcome: {kind: "withdrawn", in: 2, reason: "explicit"}})]);
        const result = nextQuestions({previous, markup: [markup("old"), markup("pulled")], version: 3, keep: [], answeredIds: new Set()});
        expect(result.questions.map((entry) => entry.outcome?.kind)).toEqual(["superseded", "withdrawn"]);
        expect(result.retiredInPage).toEqual(["old", "pulled"]);
    });

    test("关闭把未答的题记成因关闭而撤回；重新打开恢复这些题里页面还在的与 ask 登记的，其余结局不变", () => {
        const v1 = version(1, [
            question("open-in-page"), question("open-gone"), question("answered"), question("explicit", {outcome: {kind: "withdrawn", in: 1, reason: "explicit"}}),
            question("asked", {origin: "ask", page: null}), question("asked-explicit", {origin: "ask", page: null, outcome: {kind: "withdrawn", in: 1, reason: "explicit"}}),
        ]);
        const closed = closeQuestions(v1, new Set(["answered"]), 2);
        expect(closed.withdrawn).toEqual(["open-in-page", "open-gone", "asked"]);
        expect(closed.questions.map((entry) => entry.outcome)).toEqual([
            {kind: "withdrawn", in: 2, reason: "closed"},
            {kind: "withdrawn", in: 2, reason: "closed"},
            null,
            {kind: "withdrawn", in: 1, reason: "explicit"},
            {kind: "withdrawn", in: 2, reason: "closed"},
            {kind: "withdrawn", in: 1, reason: "explicit"},
        ]);
        const v2 = version(2, closed.questions, {state: "closed", action: "close"});
        const reopened = nextQuestions({previous: v2, markup: [markup("open-in-page"), markup("answered"), markup("explicit")], version: 3, keep: [], answeredIds: new Set(["answered"])});
        expect(reopened.questions.map((entry) => [entry.id, entry.outcome?.kind ?? null])).toEqual([
            ["open-in-page", null], ["open-gone", "withdrawn"], ["answered", null], ["explicit", "withdrawn"], ["asked", null], ["asked-explicit", "withdrawn"],
        ]);
        expect([reopened.restored, reopened.retiredInPage]).toEqual([["open-in-page", "asked"], ["explicit"]]);
        // 没有关闭过的产物：撤回的 ask 题不因发布复活。
        const notReopened = nextQuestions({previous: {...v2, state: "open"}, markup: [], version: 3, keep: [], answeredIds: new Set()});
        expect(notReopened.restored).toEqual([]);
    });
});

describe("题的状态与未确认的答复", () => {
    test("按最新一版的定义校验最新的取值：合法为 answered；选项改了以后回到 open，旧答复列进 stale 并标出原因；结局优先", () => {
        const answers = [answer(id("20261012T100000000Z"), {pick: "a", text: "x"}), answer(id("20261012T100001000Z"), {pick: "c"}, {artifactVersion: 2})];
        const current = version(3, [
            question("pick", {options: [{value: "a", label: "A"}, {value: "c", label: "C"}]}),
            question("text", {type: "text", options: []}),
            question("unanswered"),
            question("gone", {outcome: {kind: "superseded", in: 3, by: null}}),
        ]);
        const states = questionStates(current, answers, new Map());
        expect(states.map((state) => [state.question.id, state.state, state.answer?.value ?? null, state.answer?.artifactVersion ?? null])).toEqual([
            ["pick", "answered", "c", 2],
            ["text", "answered", "x", 1],
            ["unanswered", "open", null, null],
            ["gone", "superseded", null, null],
        ]);
        const v2 = version(2, [question("pick", {options: [{value: "a", label: "A"}, {value: "c", label: "C"}]})]);
        const v4 = version(4, [question("pick", {options: [{value: "a", label: "A"}, {value: "b", label: "B"}]})]);
        const narrowed = questionStates(v4, answers, new Map([[2, v2]]));
        expect(narrowed[0]).toMatchObject({state: "open", answer: null, stale: {answerId: id("20261012T100001000Z"), value: "c", code: "stale_value"}});
        // 按它针对的那一版也不合法（手改坏的文件），或那一版读不到：invalid_value。
        const broken = [...answers, answer(id("20261012T100002000Z"), {pick: "zzz"}, {artifactVersion: 2})];
        expect(questionStates(v4, broken, new Map([[2, v2]]))[0]?.stale?.code).toBe("invalid_value");
        expect(questionStates(v4, answers, new Map())[0]?.stale?.code).toBe("invalid_value");
    });

    test("待答（waitingStates）：没答的题都算，选答题在它出现之后交过一次答复就不再算；之前几版的题（答复作废后也是 open）不算", () => {
        const current = version(3, [
            question("required"),
            question("optional", {required: false}),
            question("earlier", {page: null}),
            question("asked", {origin: "ask", page: null, type: "text", options: []}),
            question("newer", {required: false, since: 3}),
        ]);
        const waitingIds = (answers: AnswerRecord[]) => waitingStates(questionStates(current, answers, new Map()), answers).map((state) => state.question.id);
        expect(waitingIds([])).toEqual(["required", "optional", "asked", "newer"]);
        // 之前几版的题的答复按它那一版也不合法（手改坏的文件）：作废，状态回到 open。这份答复交在 v2：v1 就有的选答题算理过，v3 才出的还在等；必答题没答照样等。
        const onV2 = {...answer(id("20261012T100000000Z"), {earlier: "zzz"}), artifactVersion: 2};
        expect(waitingIds([onV2])).toEqual(["required", "asked", "newer"]);
    });

    test("未确认按集合差算：落位晚、id 小的答复也不会被漏掉；through 不参与判断", () => {
        const early = answer(id("20261012T100000000Z", "aaaaaaaa"), {pick: "a"});
        const late = answer(id("20261012T100005000Z", "bbbbbbbb"), {pick: "b"});
        const acks = [ack(id("20261012T100006000Z"), [late.answerId])];
        expect(unackedAnswers([early, late], acks).map((entry) => entry.answerId)).toEqual([early.answerId]);
        expect(adoptionOf([early, late], acks)).toBe("waiting");
        expect(adoptionOf([early, late], [...acks, ack(id("20261012T100007000Z"), [early.answerId])])).toBe("adopted");
        expect(adoptionOf([], [])).toBe("none");
        expect(answersAfter([early, late], early.answerId).map((entry) => entry.answerId)).toEqual([late.answerId]);
    });

    test("新的 id 单调：时钟落后于目录里最大的 id 时取它加 1 毫秒；确认的 id 也算在内", () => {
        const now = new Date("2026-10-12T10:00:00.000Z");
        expect(nextRecordId([], now, "0000000a")).toBe("20261012T100000000Z-0000000a");
        expect(nextRecordId([id("20261012T100500000Z")], now, "0000000b")).toBe("20261012T100500001Z-0000000b");
        expect(nextRecordId([`ack-${id("20261012T110000999Z")}`], now, "0000000c")).toBe("20261012T110001000Z-0000000c");
        expect(RECORD_ID_PATTERN.test(nextRecordId([], now))).toBe(true);
    });
});

describe("产物文件的读取", () => {
    async function writeJson(root: string, path: string, value: unknown): Promise<void> {
        await mkdir(dirname(join(root, path)), {recursive: true});
        await writeFile(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
    }

    test("读最新一版与指定的一版、全部答复与确认；坏文件与不认识的 schema 给警告后跳过；最新一版读不出时不退回旧版", async () => {
        const fixture = await createFixture("artifact-read");
        const root = fixture.main;
        await writeJson(root, versionPath(REF, 1), version(1, [question("pick")]));
        await writeJson(root, versionPath(REF, 2), version(2, [question("pick")], {title: "第二版"}));
        const good = id("20261012T100000000Z", "11111111");
        await writeJson(root, answerPath(REF, good), answer(good, {pick: "a"}));
        await writeJson(root, ackPath(REF, id("20261012T100001000Z")), ack(id("20261012T100001000Z"), [good]));
        await writeJson(root, answerPath(REF, id("20261012T100002000Z", "22222222")), "{坏");
        await writeJson(root, answerPath(REF, id("20261012T100003000Z", "33333333")), {...answer(id("20261012T100003000Z", "33333333"), {}), schema: "nbdev.answer/v2"});
        const snapshot = await readArtifact(root, REF, {version: 1});
        expect([snapshot.versions, snapshot.latest?.title, snapshot.selected?.version]).toEqual([[1, 2], "第二版", 1]);
        expect([snapshot.answers.map((entry) => entry.answerId), snapshot.acks.map((entry) => entry.answers)]).toEqual([[good], [[good]]]);
        expect(snapshot.warnings.map((warning) => warning.code)).toEqual(["unreadable_artifact_record", "schema_unsupported"]);

        await writeJson(root, versionPath(REF, 3), {...version(3, []), version: 4});
        const broken = await readArtifact(root, REF);
        expect([broken.latest, broken.warnings[0]?.code]).toEqual([null, "unreadable_artifact_record"]);
    });

    test("候选是 Git 会跟踪的文件（去掉 versions/、answers/ 与被忽略的）；contentHash 只算文件集：没被引用的未跟踪文件不改变它，与写入顺序无关；遇到符号链接就拒绝", async () => {
        const fixture = await createFixture("artifact-files");
        const base = ".agents/works/w00001-seed/tasks/t01-seed/artifacts/review";
        const dir = join(fixture.main, base);
        await fixture.write(`${base}/r1/图.html`, "<p>一</p>");
        await fixture.write(`${base}/index.html`, '<p>入口</p><img src="pic.png">');
        await fixture.write(`${base}/pic.png`, "图");
        await fixture.write(`${base}/versions/v1.json`, "{}");
        await fixture.write(`${base}/answers/x.json`, "{}");
        await fixture.write(`${base}/debug.log`, "忽略");
        await fixture.write(`${base}/.gitignore`, "*.log\n");
        expect((await listArtifactFiles(fixture.main, REF)).map((file) => file.path)).toEqual([".gitignore", "index.html", "pic.png", "r1/图.html"]);
        const hashOf = async () => artifactContentHash(fixture.main, REF, (await artifactFileSet(fixture.main, REF, {entry: "index.html", seeds: []})).files);
        const set = await artifactFileSet(fixture.main, REF, {entry: "index.html", seeds: []});
        expect([set.files.map((file) => file.path), set.unreferenced]).toEqual([["index.html", "pic.png"], [`${base}/.gitignore`, `${base}/r1/图.html`]]);
        const first = await hashOf();
        await rm(join(dir, "index.html"));
        await writeFile(join(dir, "index.html"), '<p>入口</p><img src="pic.png">');
        await fixture.write(`${base}/shot.png`, "检查页面时的截图");
        expect(await hashOf()).toBe(first);
        await writeFile(join(dir, "pic.png"), "换了图");
        expect(await hashOf()).not.toBe(first);
        await symlink("/etc/hostname", join(dir, "link.html"));
        await expect(listArtifactFiles(fixture.main, REF)).rejects.toMatchObject({code: "unsafe_path"});
    });

    test("文档类产物：目录第一层除 README 外的 Markdown，标题取第一个一级标题", async () => {
        const fixture = await createFixture("artifact-documents");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/requirements.md", "# 需求分析\n\n正文\n");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/notes.md", "没有标题\n");
        await fixture.write(".agents/works/w00001-seed/tasks/t01-seed/evidences/deep.md", "# 不算\n");
        expect(await listDocuments(fixture.main, ".agents/works/w00001-seed/tasks/t01-seed")).toEqual([
            {path: ".agents/works/w00001-seed/tasks/t01-seed/notes.md", title: null},
            {path: ".agents/works/w00001-seed/tasks/t01-seed/requirements.md", title: "需求分析"},
        ]);
    });
});

describe("provenance", () => {
    const lease: LeaseRecord = {
        schema: "nbdev.lease/v1", leaseId: "0123456789abcdef01234567", workId: "w00001-seed", taskId: "t01-seed",
        session: {key: "external:bob", agent: "external", sessionId: null, label: "bob", parentSessionId: null, nestedSessionId: null, process: null, herdr: null},
        acquiredAt: T0, lastActivityAt: T0, lastAction: "artifact publish", releasedAt: null, releaseReason: null,
    };

    test("记下入库文件的 sha256；askerOf 按题的 since 找到那一版的 provenance，文件被重建（内容不同）后不再认", async () => {
        const fixture = await createFixture("artifact-provenance");
        const content = JSON.stringify(version(1, [question("pick")]));
        await fixture.write(versionPath(REF, 1), content);
        await fixture.write(versionPath(REF, 2), JSON.stringify(version(2, [question("pick"), question("later", {since: 2})])));
        await writeProvenance(fixture.main, {path: versionPath(REF, 1), content, action: "publish", lease, now: new Date(T0)});
        expect(await askerOf(fixture.main, REF, "pick")).toMatchObject({leaseId: lease.leaseId, session: {key: "external:bob"}, action: "publish"});
        expect(await askerOf(fixture.main, REF, "later")).toBeNull();
        await fixture.write(versionPath(REF, 1), JSON.stringify(version(1, [question("pick", {label: "重建的"})])));
        expect(await verifiedProvenance(fixture.main, versionPath(REF, 1))).toBeNull();
        expect(await askerOf(fixture.main, REF, "pick")).toBeNull();
    });
});
