/**
 * canon.project 场景 1“星瑕的一周”：t16 原型里的星瑕样本（开局、填数、两章的计划与记账、改设定、Agent 给建议、
 * 还原、补记）作为写入请求依次经世界服务发布到一个临时项目（真实的 `./node` 存储），每个读取位置上的条目状态、
 * 待处理与回执和原型算出的相比，只在差异清单（`sample/differences.ts`）里有出入；关掉再打开，结果逐字相同。
 *
 * 原型的写入与结果由 w00039 t29 的 `scripts/xingxia-export.ts` 从 t16 草稿 worktree 导出，存成
 * `sample/xingxia-prototype.json`（草稿从不提交）。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import {buildRegistry, type ReadPosition} from "../src/index";
import {WorldService} from "../src/node/index";
import {componentDeclarations, type PrototypeSample} from "./sample/convert";
import {DIFFERENCES} from "./sample/differences";
import {differences, ports, replay} from "./sample/replay";

const sample = JSON.parse(await readFile(join(import.meta.dir, "sample", "xingxia-prototype.json"), "utf8")) as PrototypeSample & {readonly receipts: ReadonlyArray<{readonly id: string; readonly impact: {readonly resolved: readonly string[]; readonly added: readonly string[]; readonly values: ReadonlyArray<{readonly label: string}>}}>};

let root = "";
beforeEach(async () => {
    root = await createTestTmpRoot("nb-canon-sample");
});
afterEach(async () => {
    await removeMarkedTmpRoot(root, join(root, TMP_MARKER_FILE));
});

describe("canon.project 场景 1：星瑕的一周", () => {
    test("每个读取位置上的条目状态与原型相比，只有差异清单里的出入", async () => {
        const replayed = await replay(root, sample);
        const found = differences(sample, replayed);
        expect(found).toEqual(DIFFERENCES.map(({where, entry, path, prototype, spec}) => ({where, entry, path, prototype, canon: spec})));
        await replayed.service.stop();
    });

    test("待处理与回执：同样的核对点对不上、同样的嫌疑记录；每次修订改了同样的地址，新出现与消失的待处理条数相同", async () => {
        const {service, ids} = await replay(root, sample);
        const pending = service.pending();
        if (pending === "chapter-not-found") throw new Error(pending);
        const expected = sample.pending as ReadonlyArray<{kind: string; diagnostic: {check: string; computed: number; suspects: readonly string[]}}>;
        expect(pending.items).toEqual(expected.map((item) => expect.objectContaining({kind: "check-mismatch", check: ids.get(item.diagnostic.check), computed: item.diagnostic.computed, suspects: item.diagnostic.suspects.map((id) => ids.get(id))})));

        // 第 1 次修订是打开时的章序调整，样本的修订从第 2 次起。
        const revisions = service.world.revisions.slice(1);
        expect(revisions).toHaveLength(sample.receipts.length);
        const label = (at: {entry: string; path: string}) => {
            const entry = service.world.data.entries.get(at.entry)!;
            const [namespace, field] = at.path.split(".") as [string, string];
            const declared = componentDeclarations(sample).find((type) => type.namespace === namespace)?.fields?.find((item) => item.id === field);
            return `${entry.init.name} · ${declared?.label ?? field}`;
        };
        // 主文字的块不比：原型的回执不列它们（差异清单）；只要求 Spec 这边确实列了。
        expect(revisions.some((revision) => revision.impact.values.some((value) => value.at.path.startsWith("text[")))).toBe(true);
        for (const [index, receipt] of sample.receipts.entries()) {
            const impact = revisions[index]!.impact;
            const fields = impact.values.filter((value) => !value.at.path.startsWith("text["));
            expect({revision: index + 1, labels: fields.map((value) => label(value.at)).sort(), added: impact.pendingAdded.length, resolved: impact.pendingResolved.length})
                .toEqual({revision: index + 1, labels: receipt.impact.values.map((value) => value.label).sort(), added: receipt.impact.added.length, resolved: receipt.impact.resolved.length});
        }
        await service.stop();
    });

    test("关掉项目再打开：每个读取位置上的结果逐字相同", async () => {
        const {service, ids} = await replay(root, sample);
        const positions = sample.results.map((result) => result.position as ReadPosition);
        const entries = Object.keys(sample.results[0]!.entries).map((id) => ids.get(id));
        const snapshot = (from: WorldService) => positions.map((position) => entries.map((id) => from.entry(id, position, "actual")));
        const before = snapshot(service);
        await service.stop();

        const texts = new Map(sample.chapters.map((chapter) => [chapter.id, chapter.text]));
        const reopened = await WorldService.open(ports(root, sample, texts), {chapters: sample.chapters.map((chapter) => chapter.id), registry: buildRegistry(componentDeclarations(sample))});
        if ("code" in reopened) throw new Error(reopened.code);
        expect(reopened.status().version).toBe(service.status().version);
        expect(snapshot(reopened)).toEqual(before);
        await reopened.stop();
    });
});
