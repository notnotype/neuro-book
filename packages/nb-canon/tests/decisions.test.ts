import {describe, expect, test} from "bun:test";

import {buildDiagnosticRegistry, buildRegistry, ChapterOrder, type Authorization, type Decision, type Entry, type RevertRequest, type WriteRequest} from "../src/index";
import {decisionView} from "../src/world/decisions";
import {World, type RevertMeta, type WorldOptions, type WriteResult} from "../src/world/world";
import {digest, PROJECT, sign, verify} from "./fixtures/authorization";
import {PERSON} from "./fixtures/world";

function options(extra: Partial<WorldOptions> = {}): WorldOptions {
    return {
        order: new ChapterOrder(["ch1", "ch2", "ch20"]),
        registry: buildRegistry([PERSON]),
        reductions: () => undefined,
        chapterText: () => "",
        digest,
        project: PROJECT,
        verifyAuthorSource: verify,
        diagnostics: buildDiagnosticRegistry([{plugin: "nbook.plot", declaration: {id: "nbook.plot.leak", version: 2, level: "pending", label: "知情越界", key: ["objects", "telling"]}}]),
        ...extra,
    };
}

let sequence = 0;
function request(puts: WriteRequest["puts"], baseVersion: number, by: WriteRequest["by"] = {kind: "agent", session: "s1"}): WriteRequest {
    return {requestId: `d-${String(++sequence)}`, by, what: "edit", title: "决策", baseVersion, puts};
}
const withAuth = (input: WriteRequest, ...authorizations: Authorization[]): WriteRequest => ({...input, authorizations});

function ok(result: WriteResult | {readonly ok: false; readonly failure: unknown}): Extract<WriteResult, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result;
}
const failure = (result: WriteResult | {ok: false; failure: unknown}) => (result.ok ? null : result.failure);
const problems = (result: WriteResult) => (!result.ok && result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => [problem.code, problem.path]) : []);

const pending = (id: string, extra: Partial<Decision> = {}): Decision => ({id, text: "哥哥的秘密在哪一章揭开", status: "pending", about: [], hints: [], ...extra});
const putDecision = (decision: Decision) => ({ref: {kind: "decision" as const, id: decision.id}, after: decision});
const person = (id: string, name: string): Entry => ({id, type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {}}});

/** 一条待定的决策 d1（Agent 写的，带建议），版本 1。 */
function start(extra: Partial<WorldOptions> = {}): {world: World; id: string} {
    const created = ok(World.empty(options(extra)).publish(request([putDecision(pending("tmp:d", {suggestion: {conclusion: "第 20 章", by: {kind: "agent", session: "s1"}}}))], 0), "t"));
    return {world: created.world, id: created.ids["tmp:d"]!};
}
const stored = (world: World, id: string) => world.data.decisions.get(id)!;

describe("canon.model 验收场景 9：决策", () => {
    test("新建的待定决策不能带结论、理由、约束（只在已定时起作用的字段），否则读起来像作者定过又重新打开", () => {
        const world = World.empty(options());
        const forged = world.publish(request([putDecision(pending("tmp:d", {conclusion: "第 3 章揭开", reason: "作者说过", constraints: ["只给暗示"]}))], 0), "t");
        expect(problems(forged as WriteResult).map(([code]) => code)).toEqual(["invalid-transition"]);
        expect(ok(world.publish(request([putDecision(pending("tmp:d", {candidates: ["第 3 章", "第 20 章"]}))], 0), "t")).world.data.decisions.size).toBe(1);
    });

    test("建议标作者未确认；不带来源转成已定被拒；带来源转成已定；之后 Agent 改约束被拒；作者带来源重新打开", () => {
        const {world, id} = start();
        expect(decisionView(stored(world, id), () => undefined).unconfirmed).toBe(true);

        const decide = request([putDecision({...stored(world, id), status: "decided", conclusion: "定在第 20 章，前面只给暗示"})], 1);
        expect(failure(world.publish(decide, "t"))).toMatchObject({code: "author-source-required", needed: [{decision: id, transition: "pending→decided"}]});
        const decided = ok(world.publish(withAuth(decide, sign(decide, id, "pending→decided")), "t"));
        const after = stored(decided.world, id);
        expect(after).toMatchObject({status: "decided", conclusion: "定在第 20 章，前面只给暗示", source: {author: "作者", id: "m1"}});
        expect(after.suggestion).toBeUndefined();
        expect(decided.revision.authorizations).toHaveLength(1);
        // 存下的授权事后能核对绑的就是这次修订：`binds.request` 与修订存的请求摘要相同。
        expect(decided.revision.authorizations![0]!.source.binds.request).toBe(decided.revision.requestDigest);
        expect(decisionView(after, () => undefined).reason).toBe("作者没说理由");

        const constrain = request([putDecision({...after, constraints: ["第 19 章前不能明说"]})], 2);
        expect(failure(decided.world.publish(constrain, "t"))).toMatchObject({code: "author-source-required", needed: [{transition: "edit"}]});

        const {source: _source, ...withoutSource} = after;
        const reopen = request([putDecision({...withoutSource, source: after.source, status: "pending"} as Decision)], 2, {kind: "author"});
        const auth = sign(reopen, id, "decided→pending");
        const reopened = ok(decided.world.publish(withAuth(reopen, auth), "t"));
        expect(stored(reopened.world, id)).toMatchObject({status: "pending", source: auth.source});
        expect(decisionView(stored(reopened.world, id), () => undefined).earlier).toEqual({conclusion: "定在第 20 章，前面只给暗示"});
    });
});

describe("canon.model 状态与转换、输出 31、32：决策的转换", () => {
    test("不在表里的转换与改法都拒收；已定里改要定的事拒收；待定里 Agent 改候选不要来源", () => {
        const {world, id} = start();
        expect(problems(world.publish(request([putDecision({...stored(world, id), status: "superseded"})], 1), "t"))).toContainEqual(["invalid-transition", undefined]);
        // 带上宿主签好的授权也一样：报的是转换不合法，不是授权没用上。
        const skip = request([putDecision({...stored(world, id), status: "superseded"})], 1);
        expect(problems(world.publish(withAuth(skip, sign(skip, id, "pending→superseded" as Parameters<typeof sign>[2])), "t"))).toContainEqual(["invalid-transition", undefined]);
        expect(problems(world.publish(request([putDecision({...stored(world, id), conclusion: "偷偷写进去"})], 1), "t"))).toEqual([["invalid-transition", undefined]]);
        expect(ok(world.publish(request([putDecision({...stored(world, id), candidates: ["第 20 章", "第 25 章"]})], 1), "t")).ok).toBe(true);
        expect(problems(World.empty(options()).publish(request([putDecision(pending("tmp:x", {status: "dropped"}))], 0), "t"))).toEqual([["invalid-transition", undefined]]);
    });

    test("已定转成被取代：supersededBy 指向同一请求里新建并已定的决策，两项授权各签各的；指向待定的拒收", () => {
        const {world, id} = start();
        const decide = request([putDecision({...stored(world, id), status: "decided", conclusion: "第 20 章"})], 1, {kind: "author"});
        const decided = ok(world.publish(withAuth(decide, sign(decide, id, "pending→decided")), "t")).world;
        const old = stored(decided, id);
        const replace = request([
            putDecision(pending("tmp:new", {status: "decided", conclusion: "改到第 25 章"})),
            putDecision({...old, status: "superseded", supersededBy: "tmp:new"}),
        ], 2, {kind: "author"});
        const result = ok(decided.publish(withAuth(replace, sign(replace, "tmp:new", "new→decided"), sign(replace, id, "decided→superseded")), "t"));
        expect(stored(result.world, id)).toMatchObject({status: "superseded", supersededBy: result.ids["tmp:new"]});
        // 修订里存的是请求原样的授权（新建的决策还是临时 id），签名照样验得过。
        expect(result.revision.authorizations!.map((item) => [item.decision, verify(item.source)])).toEqual([["tmp:new", true], [id, true]]);

        const toPending = request([putDecision(pending("tmp:p")), putDecision({...old, status: "superseded", supersededBy: "tmp:p"})], 2, {kind: "author"});
        expect(problems(decided.publish(withAuth(toPending, sign(toPending, id, "decided→superseded")), "t"))).toEqual([["invalid-transition", "supersededBy"]]);
    });

    test("请求里改了出处：source-not-writable；取出重新打开后的整份对象只改候选写回：不要来源，出处不变", () => {
        const {world, id} = start();
        const forged = {author: "作者", via: "message", id: "x", quote: "", time: "", binds: {project: "", requestId: "", request: "", decision: id, transition: "edit", fields: ""}, signature: ""};
        expect(failure(world.publish(request([putDecision({...stored(world, id), source: forged})], 1), "t"))).toEqual({code: "source-not-writable", ref: {kind: "decision", id}});

        const decide = request([putDecision({...stored(world, id), status: "decided", conclusion: "第 20 章"})], 1, {kind: "author"});
        const decided = ok(world.publish(withAuth(decide, sign(decide, id, "pending→decided")), "t")).world;
        const reopen = request([putDecision({...stored(decided, id), status: "pending"})], 2, {kind: "author"});
        const reopened = ok(decided.publish(withAuth(reopen, sign(reopen, id, "decided→pending")), "t")).world;
        const source = stored(reopened, id).source;
        const edited = ok(reopened.publish(request([putDecision({...stored(reopened, id), candidates: ["第 21 章"]})], 3), "t")).world;
        expect(stored(edited, id).source).toEqual(source);
    });
});

describe("canon.model 输出 33：挂的对象", () => {
    test("条目不存在、章不在章序里、范围倒着、诊断的稳定键与登记的组成部分不符都拒收；版本不同的只查通用形状", () => {
        const world = World.empty(options());
        const about = (items: Decision["about"], extra: Partial<Decision> = {}) => problems(world.publish(request([putDecision(pending("tmp:d", {about: items, ...extra}))], 0), "t"));
        expect(about([{kind: "entry", id: "e99"}])).toEqual([["invalid-about", "about[0]"]]);
        expect(about([{kind: "chapter", id: "ch9"}])).toEqual([["invalid-about", "about[0]"]]);
        expect(about([], {scope: {from: "ch20", to: "ch1"}})).toEqual([["invalid-about", "scope"]]);
        expect(about([{kind: "diagnostic", id: "nbook.plot.leak", version: 2, key: {objects: [{kind: "entry", id: "e1"}]}}])).toEqual([["invalid-about", "about[0]"]]);
        expect(about([{kind: "diagnostic", id: "nbook.plot.leak", version: 2, key: {objects: [{kind: "entry", id: "e1"}], telling: "t1"}}])).toEqual([]);
        expect(about([{kind: "diagnostic", id: "nbook.plot.leak", version: 1, key: {objects: [{kind: "entry", id: "e1"}]}}])).toEqual([]);
        expect(about([{kind: "diagnostic", id: "leak", version: 1, key: {detail: "x"}}])).toEqual([["invalid-about", "about[0]"]]);
    });

    test("被挂的条目后来删了：决策照常存在，读取时那一项标已删除；改它的候选照样可以", () => {
        const created = ok(World.empty(options()).publish(request([{ref: {kind: "entry", id: "tmp:p"}, after: person("tmp:p", "星瑕")}], 0, {kind: "author"}), "t"));
        const p = created.ids["tmp:p"]!;
        const withDecision = ok(created.world.publish(request([putDecision(pending("tmp:d", {about: [{kind: "entry", id: p}]}))], 1), "t"));
        const id = withDecision.ids["tmp:d"]!;
        const deleted = ok(withDecision.world.publish(request([{ref: {kind: "entry", id: p}, after: {...withDecision.world.data.entries.get(p)!, deleted: true}}], 2, {kind: "author"}), "t")).world;
        expect(decisionView(stored(deleted, id), (entry) => deleted.data.entries.get(entry)).deletedAbout).toEqual([0]);
        expect(ok(deleted.publish(request([putDecision({...stored(deleted, id), candidates: ["第 3 章"]})], 3), "t")).ok).toBe(true);
    });
});

describe("canon.revisions 输出 21、验收场景 7：作者来源", () => {
    test("自己拼的签名、挪到另一条决策、改了结论、用在另一次请求、同一请求 id 下换了别的对象：都是 author-source-invalid", () => {
        const two = ok(World.empty(options()).publish(request([putDecision(pending("tmp:a")), putDecision(pending("tmp:b", {text: "另一件事"}))], 0), "t"));
        const [a, b] = [two.ids["tmp:a"]!, two.ids["tmp:b"]!];
        const world = two.world;
        const decideA = request([putDecision({...stored(world, a), status: "decided", conclusion: "X"})], 1, {kind: "author"});
        const auth = sign(decideA, a, "pending→decided");
        const reasonOf = (result: WriteResult) => (!result.ok && result.failure.code === "author-source-invalid" ? result.failure.problems.map((problem) => problem.reason) : result.ok ? "ok" : result.failure.code);

        expect(reasonOf(world.publish(withAuth(decideA, {...auth, source: {...auth.source, signature: "made-up"}}), "t"))).toEqual(["signature"]);
        const decideB = request([putDecision({...stored(world, b), status: "decided", conclusion: "X"})], 1, {kind: "author"});
        expect(reasonOf(world.publish(withAuth(decideB, {...auth, decision: b}), "t"))).toEqual(["binds-mismatch"]);
        const decideY = {...decideA, puts: [putDecision({...stored(world, a), status: "decided", conclusion: "Y"})]};
        expect(reasonOf(world.publish(withAuth(decideY, auth), "t"))).toEqual(["binds-mismatch"]);
        const otherRequest = {...decideA, requestId: "another"};
        expect(reasonOf(world.publish(withAuth(otherRequest, auth), "t"))).toEqual(["binds-mismatch"]);

        const withPoint = request([{ref: {kind: "entry", id: "tmp:k"}, after: person("tmp:k", "知识点")}, putDecision({...stored(world, a), status: "decided", conclusion: "X", about: [{kind: "entry", id: "tmp:k"}]})], 1, {kind: "author"});
        const pointAuth = sign(withPoint, a, "pending→decided");
        expect(reasonOf(world.publish(withAuth(withPoint, pointAuth), "t"))).toBe("ok");
        const swapped = {...withPoint, puts: [{ref: {kind: "entry" as const, id: "tmp:k"}, after: person("tmp:k", "换了一个")}, withPoint.puts[1]!]};
        expect(reasonOf(world.publish(withAuth(swapped, pointAuth), "t"))).toEqual(["binds-mismatch"]);
    });

    test("签名校验对什么都答通过时，挪到另一条决策照样被拒：binds 是内核比的；没有校验时一律不通过；用不上的、重复的授权都拒收", () => {
        const two = ok(World.empty(options({verifyAuthorSource: () => true})).publish(request([putDecision(pending("tmp:a")), putDecision(pending("tmp:b"))], 0), "t"));
        const [a, b] = [two.ids["tmp:a"]!, two.ids["tmp:b"]!];
        const decideA = request([putDecision({...stored(two.world, a), status: "decided", conclusion: "X"})], 1, {kind: "author"});
        const auth = sign(decideA, a, "pending→decided");
        const decideB = request([putDecision({...stored(two.world, b), status: "decided", conclusion: "X"})], 1, {kind: "author"});
        expect(failure(two.world.publish(withAuth(decideB, {...auth, decision: b}), "t"))).toMatchObject({code: "author-source-invalid", problems: [{reason: "binds-mismatch"}]});

        const noVerifier = two.world.withOptions({...two.world.options, verifyAuthorSource: undefined});
        expect(failure(noVerifier.publish(withAuth(decideA, auth), "t"))).toMatchObject({code: "author-source-invalid", problems: [{reason: "no-verifier"}]});
        // 宿主没给项目标识：同样不验。否则一个按空项目标识签的来源（这里的校验对什么都答通过）就能在各个项目之间挪用。
        const noProject = two.world.withOptions({...two.world.options, project: undefined});
        const anyProject = {...auth, source: {...auth.source, binds: {...auth.source.binds, project: ""}}};
        expect(failure(noProject.publish(withAuth(decideA, anyProject), "t"))).toMatchObject({code: "author-source-invalid", problems: [{reason: "no-verifier"}]});
        const candidates = request([putDecision({...stored(two.world, a), candidates: ["第 20 章"]})], 1);
        expect(failure(two.world.publish(withAuth(candidates, sign(candidates, a, "edit")), "t"))).toMatchObject({code: "author-source-invalid", problems: [{reason: "authorization-unused"}]});
        expect(failure(two.world.publish(withAuth(decideA, auth, auth), "t"))).toMatchObject({code: "author-source-invalid", problems: [{reason: "authorization-duplicate"}]});
    });

    test("还原改过两条已定决策的修订：不带授权得到 author-source-required；预览列出两项，照签后还原成功，决策回到待定", () => {
        const two = ok(World.empty(options()).publish(request([putDecision(pending("tmp:a")), putDecision(pending("tmp:b"))], 0), "t"));
        const [a, b] = [two.ids["tmp:a"]!, two.ids["tmp:b"]!];
        const decideBoth = request([putDecision({...stored(two.world, a), status: "decided", conclusion: "X"}), putDecision({...stored(two.world, b), status: "decided", conclusion: "Z"})], 1, {kind: "author"});
        const decided = ok(two.world.publish(withAuth(decideBoth, sign(decideBoth, a, "pending→decided"), sign(decideBoth, b, "pending→decided")), "t"));

        const meta: RevertMeta = {requestId: "revert-1", by: {kind: "agent", session: "s1"}};
        expect(failure(decided.world.revert(decided.revision.id, false, meta, "t"))).toMatchObject({code: "author-source-required", needed: [{decision: a, transition: "revert"}, {decision: b, transition: "revert"}]});
        const preview = decided.world.previewRevert(decided.revision.id, false, meta, "t");
        if ("ok" in preview) throw new Error(JSON.stringify(preview.failure));
        expect(preview.needed.map((item) => item.decision)).toEqual([a, b]);
        const revertRequest: RevertRequest = {revert: decided.revision.id, withDependents: false, requestId: meta.requestId, by: meta.by};
        const authorizations = preview.needed.map((item) => sign(revertRequest, item.decision, "revert", item.fields));
        const reverted = ok(decided.world.revert(decided.revision.id, false, {...meta, authorizations}, "t"));
        expect(reverted.revision.authorizations!.map((item) => item.source.binds.request)).toEqual([reverted.revision.requestDigest, reverted.revision.requestDigest]);
        expect([stored(reverted.world, a).status, stored(reverted.world, b).status]).toEqual(["pending", "pending"]);
        expect(stored(reverted.world, a).source).toBeUndefined();
        expect(reverted.revision.authorizations).toHaveLength(2);
    });
});
