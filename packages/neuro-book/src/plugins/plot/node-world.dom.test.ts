/**
 * 剧情插件的项目入口装在进程内的世界场地上（canon/testing/node-world.ts）：剧情界面的组件测试建在它上面。项目入口依赖存储，
 * 存储的分区在 Vitest 里跑在 `node:sqlite` 上（`@notnotype/neuro-book-test-support/bun-sqlite`）；这里确认窗口经远程读得到剧情的
 * 读取，写作指示经存储写下以后，数据版本跟着变。
 */

import {rm} from "node:fs/promises";

import {afterEach, beforeEach, describe, expect, it} from "vitest";

import type {DelegatedRemoteAccess} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {canonNodeWorld} from "nbook/plugins/canon/testing/node-world";
import type {CanonNodeWorld} from "nbook/plugins/canon/testing/node-world";
import {storageBackendPlugin} from "nbook/plugins/storage/backend/plugin";
import {descriptor as storageDescriptor} from "nbook/plugins/storage/plugin";

import {plotProjectPlugin} from "./backend/plugin";
import {descriptor} from "./plugin";
import {plotAuthorContract} from "./shared/author";
import {plotWorldContract} from "./shared/contracts";
import {plotInstructionsContract} from "./shared/instructions";
import {drafts} from "./testing/world";

let tmp: string;
let world: CanonNodeWorld | null = null;

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-plot", "node-world");
});

afterEach(async () => {
    await world?.close();
    world = null;
    await rm(tmp, {recursive: true, force: true});
});

describe("剧情插件在进程内的世界场地上", () => {
    it("窗口读得到剧情的读取；写作指示写进存储以后数据版本跟着变", async () => {
        world = await canonNodeWorld(tmp, {project: [definitionAt("project", storageDescriptor, storageBackendPlugin), definitionAt("project", descriptor, plotProjectPlugin)]});
        let remote: DelegatedRemoteAccess | null = null;
        const window = await world.window("w1", [{id: "test.plot-user", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
            remote = context.remote;
            return {};
        }}]}]);
        await waitUntil("世界打开", async () => (await window.canon.call("status", {})).ok, {timeoutMs: 10_000});
        const plot = remote!.use(plotWorldContract);
        const instructions = remote!.use(plotInstructionsContract);

        const ledger = await plot.ledger({});
        expect(ledger).toMatchObject({ok: true, value: {items: []}});

        const before = await instructions.current({});
        if (!before.ok) throw new Error(JSON.stringify(before));
        const put = await instructions.put({chapter: "ch1", snapshot: {chapter: "ch1", version: "v1", ending: "停在门口"}, base: before.value.dataVersion});
        if (!put.ok) throw new Error(JSON.stringify(put));
        expect(put.value.dataVersion).not.toBe(before.value.dataVersion);
        expect(await instructions.current({})).toEqual({ok: true, value: {dataVersion: put.value.dataVersion}});

        // 作者用的读取：人物的知情与秘密的“谁知道”，结果带线与名字表。
        const author = remote!.use(plotAuthorContract);
        const status = await window.canon.call("status", {});
        if (!status.ok) throw new Error(JSON.stringify(status.failure));
        const published = await window.canon.publish({requestId: "author-1", by: {kind: "author"}, what: "edit", title: "人物与秘密", baseVersion: status.value.version, puts: [
            {ref: {kind: "entry", id: "tmp:xia"}, after: drafts.person("tmp:xia", "星瑕")},
            {ref: {kind: "entry", id: "tmp:k"}, after: drafts.point("tmp:k", "哥哥就是星瑕", "tmp:xia")},
        ]});
        if (!published.ok) throw new Error(JSON.stringify(published.failure));
        const xia = published.value.ids["tmp:xia"]!;
        const k = published.value.ids["tmp:k"]!;
        expect(await author.person({person: xia})).toMatchObject({ok: true, value: {line: "main", secrets: [{point: k, degree: "none"}], others: [], names: {[k]: {name: "哥哥就是星瑕"}, [xia]: {name: "星瑕"}}}});
        expect(await author.point({point: k})).toMatchObject({ok: true, value: {secrecy: "secret", people: [], peopleTotal: 0, rest: {count: 1, unaware: true}, reader: {degree: "unaware"}}});
        expect(await author.point({point: xia})).toEqual({ok: false, code: "plot", detail: {code: "not-found"}});
        expect(await author.secrets({people: [xia], limit: 10})).toMatchObject({ok: true, value: {line: "main", counts: {all: 1, readerOnly: 0, readerUnaware: 1, noPlan: 1}, candidates: [], main: [], items: [{point: k, subject: xia, people: {[xia]: {degree: "none"}}}], names: {[k]: {name: "哥哥就是星瑕"}, [xia]: {name: "星瑕"}}}});
        expect(await author.goals({})).toMatchObject({ok: true, value: {line: "main", items: [], names: {}}});
        expect(await author.ledger({segment: "all"})).toMatchObject({ok: true, value: {counts: {unpaid: 0, silent: 0, unplanned: 0, dropped: 0, all: 0}, items: []}});
        expect(await author.experience({person: xia})).toMatchObject({ok: true, value: {uncast: 0, items: []}});
        expect(await author.experience({person: "no-such"})).toEqual({ok: false, code: "plot", detail: {code: "not-found"}});
        // 人物页与经历只读人物与组织：传知识点是 not-found。
        expect(await author.person({person: k})).toEqual({ok: false, code: "plot", detail: {code: "not-found"}});
        expect(await author.experience({person: k})).toEqual({ok: false, code: "plot", detail: {code: "not-found"}});

        // 一个秘密挂 60 条待定决策、星瑕的目标隐秘是它，另有第二个秘密。
        const after = await window.canon.call("status", {});
        if (!after.ok) throw new Error(JSON.stringify(after.failure));
        const decisions = Array.from({length: 60}, (_, index) => ({ref: {kind: "decision" as const, id: `tmp:d${String(index)}`}, after: {id: `tmp:d${String(index)}`, text: `第 ${String(index + 1)} 条决策`, status: "pending" as const, about: [{kind: "entry" as const, id: k}], hints: []}}));
        const more = await window.canon.publish({requestId: "author-2", by: {kind: "author"}, what: "edit", title: "目标与决策", baseVersion: after.value.version, puts: [
            {ref: {kind: "entry", id: "tmp:g"}, after: drafts.goal("tmp:g", "不让妹妹发现", xia, {隐秘: {ref: k}})},
            {ref: {kind: "entry", id: "tmp:k2"}, after: drafts.point("tmp:k2", "那几年是被软禁", xia)},
            ...decisions,
        ]});
        if (!more.ok) throw new Error(JSON.stringify(more.failure));
        // 目标表的名字表带目标引用到的条目（隐秘指向的秘密）。
        const goals = await author.goals({});
        expect(goals.ok && (goals.value as {names: Record<string, {name: string}>}).names[k]).toMatchObject({name: "哥哥就是星瑕"});
        // 和它有关的每个列表至多 50 条，另给总数；保密表一行至多 10 条决策，截掉的给条数。
        const detail = await author.point({point: k});
        expect(detail).toMatchObject({ok: true, value: {relatedTotals: {decisions: 60}}});
        expect(detail.ok && (detail.value as {related: {decisions: unknown[]}}).related.decisions).toHaveLength(50);
        const table = await author.secrets({people: [xia], limit: 1});
        if (!table.ok) throw new Error(JSON.stringify(table));
        const row = (table.value as {items: {point: string; decisions: unknown[]; plansMore: number}[]; cursor?: string});
        expect(row.items.map((item) => [item.point, item.decisions.length, item.plansMore])).toEqual([[k, 10, 50]]);
        // 带游标的先核游标：读取输入变了以后，位置写着一条读不到的线也是 cursor-stale，不改报 line-not-found。
        await window.canon.publish({requestId: "author-3", by: {kind: "author"}, what: "edit", title: "改一下", baseVersion: more.value.version, puts: [{ref: {kind: "entry", id: more.value.ids["tmp:k2"]!}, after: drafts.point(more.value.ids["tmp:k2"]!, "那几年哥哥是被软禁", xia)}]});
        expect(await author.secrets({people: [xia], limit: 1, cursor: row.cursor!, position: {kind: "initial", line: "no-such-line"}})).toEqual({ok: false, code: "plot", detail: {code: "cursor-stale"}});
        await window.close();
    });
});
