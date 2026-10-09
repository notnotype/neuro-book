/**
 * Files 样本生成器：同一参数得到同样的布局与字节数，覆盖宽目录与内容文件夹的几种情况，正文的字节数精确。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {readdir, readFile, rm, stat} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {planSample, renderSample, writeSample} from "./files-sample";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "sample");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("Files 样本生成器", () => {
    it("同一 seed 布局与大小相同；不同 seed 大小不同；文件数、宽目录与内容文件夹的情况齐全", () => {
        const first = planSample();
        expect(planSample()).toEqual(first);
        expect(planSample({seed: 7}).files.map((file) => file.bytes)).not.toEqual(first.files.map((file) => file.bytes));
        expect(first.description.count).toBe(3000);
        expect(first.files.filter((file) => file.path.startsWith("notes/wide/"))).toHaveLength(400);
        expect(first.description.totalBytes).toBe(first.files.reduce((sum, file) => sum + file.bytes, 0));
        const cases = first.description.contentCases;
        expect([cases.withoutBody.length > 0, cases.unlisted.length > 0, cases.missing.length > 0]).toEqual([true, true, true]);
        for (const directory of cases.unlisted) expect(first.manifest).not.toContain(`name="${directory.split("/").at(-1)!}"`);
        for (const directory of cases.missing) expect(first.manifest).toContain(`name="${directory.split("/").at(-1)!}"`);
        expect(new Set(first.files.map((file) => file.path)).size).toBe(first.files.length);
    });

    it("写到磁盘：文件数、总字节、宽目录与清单与描述一致；目标目录不空时拒绝", async () => {
        const target = join(tmp, "sample");
        const description = await writeSample(target, {count: 600, wide: 120});
        const files = (await readdir(target, {recursive: true, withFileTypes: true})).filter((entry) => entry.isFile());
        const samples = files.filter((entry) => entry.name !== "content.xml");
        expect(samples).toHaveLength(description.count);
        let total = 0;
        for (const entry of samples) total += (await stat(join(entry.parentPath, entry.name))).size;
        expect(total).toBe(description.totalBytes);
        expect(await readdir(join(target, description.wideDirectory.path))).toHaveLength(description.wideDirectory.entries);
        expect(await readFile(join(target, description.contentRoot, "content.xml"), "utf8")).toBe(planSample({count: 600, wide: 120}).manifest);
        const cold = description.open.cold;
        expect((await readFile(join(target, cold.address.slice("project://".length)), "utf8")).startsWith(`# ${cold.marker}`)).toBe(true);
        await expect(writeSample(target, {count: 600, wide: 120})).rejects.toThrow("不是空目录");
    });

    it("正文按 UTF-8 精确到计划的字节数，第一行是标记", () => {
        for (const file of planSample({count: 600}).files.slice(0, 50)) {
            const text = renderSample(file);
            expect(new TextEncoder().encode(text).length).toBe(file.bytes);
            expect(text.startsWith(`# ${file.marker}\n`)).toBe(true);
        }
    });
});
