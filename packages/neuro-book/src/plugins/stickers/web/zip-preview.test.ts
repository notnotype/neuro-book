/**
 * 导入同名时“要导入的”那一侧的预览（`zip-preview.ts`，docs/specs/agent/stickers.md 输出 36）：数图片、挑前几张画缩略图、
 * 读不出的 zip 只给 null；预览图的对象地址交回 `dispose` 成对释放。
 */

import {describe, expect, test} from "bun:test";

import {strToU8, zipSync} from "fflate";

import {previewZip} from "./zip-preview";

const png = new Uint8Array([137, 80, 78, 71]);
const fileOf = (entries: Record<string, Uint8Array>): File => new File([zipSync(entries) as Uint8Array<ArrayBuffer>], "cat.zip");

describe("zip 预览", () => {
    test("数图片、取文件夹名与前 4 张；忽略清单、隐藏文件与 macOS 附带的目录；dispose 释放全部对象地址", async () => {
        const entries: Record<string, Uint8Array> = {"cat/stickers.json": strToU8("{}"), "cat/.hidden.png": png, "__MACOSX/cat/._a.png": png, "cat/readme.txt": strToU8("x")};
        for (const name of ["a", "b", "c", "d", "e"]) entries[`cat/${name}.png`] = png;
        const created: string[] = [];
        const revoked: string[] = [];
        const original = {create: URL.createObjectURL, revoke: URL.revokeObjectURL};
        URL.createObjectURL = () => {
            const url = `blob:test/${String(created.length)}`;
            created.push(url);
            return url;
        };
        URL.revokeObjectURL = (url) => void revoked.push(url);
        try {
            const preview = await previewZip(fileOf(entries));
            expect(preview.title).toBe("cat");
            expect(preview.count).toBe(5);
            expect(preview.items.map((item) => item.label)).toEqual(["cat/a.png", "cat/b.png", "cat/c.png", "cat/d.png"]);
            expect(created).toHaveLength(4);
            preview.dispose();
            expect(revoked).toEqual(created);
        } finally {
            URL.createObjectURL = original.create;
            URL.revokeObjectURL = original.revoke;
        }
    });

    test("读不出的 zip：标题与个数都是 null，没有预览图，dispose 照样能调", async () => {
        const preview = await previewZip(new File([new Uint8Array([1, 2, 3])], "bad.zip"));
        expect(preview).toMatchObject({title: null, count: null, items: []});
        preview.dispose();
    });
});
