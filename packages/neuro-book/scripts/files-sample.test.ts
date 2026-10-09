/**
 * Files 样本生成器：同一参数得到同样的布局与字节数，覆盖宽目录与内容文件夹的几种情况，正文的字节数精确。
 */

import {describe, expect, it} from "bun:test";

import {planSample, renderSample} from "./files-sample";

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

    it("正文按 UTF-8 精确到计划的字节数，第一行是标记", () => {
        for (const file of planSample({count: 600}).files.slice(0, 50)) {
            const text = renderSample(file);
            expect(new TextEncoder().encode(text).length).toBe(file.bytes);
            expect(text.startsWith(`# ${file.marker}\n`)).toBe(true);
        }
    });
});
