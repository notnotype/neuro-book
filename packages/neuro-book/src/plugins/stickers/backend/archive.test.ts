/**
 * 导入 zip 的核对与导出的打包（docs/specs/agent/stickers.md 输出 35、36）：纯函数。zip 由 fflate 现打；超限的样本是压得很小、解开
 * 很大的零字节文件，验证按实际解出的字节计数、超了立即停止。
 */

import {describe, expect, test} from "bun:test";

import {strToU8, zipSync} from "fflate";

import {ARCHIVE_LIMITS, packNameFrom, unpackZip, zipPack} from "./archive";

const PIXEL = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));
const manifest = strToU8(JSON.stringify({title: "猫"}));
const zip = (entries: Record<string, Uint8Array>): Uint8Array => zipSync(entries);
const reason = (result: ReturnType<typeof unpackZip>): string => (result.ok ? "" : result.reason);
const names = (result: ReturnType<typeof unpackZip>): string[] => (result.ok ? [...result.files.keys()].sort() : []);

describe("导入的形状", () => {
    test("一个文件夹：包名取文件夹名，只收清单与图片，子文件夹与别的文件忽略", () => {
        const result = unpackZip(zip({"cat/stickers.json": manifest, "cat/开心.png": PIXEL, "cat/readme.txt": strToU8("说明"), "cat/sub/里面.png": PIXEL, "cat/": new Uint8Array()}));
        expect(result.ok && result.folder).toBe("cat");
        expect(names(result)).toEqual(["stickers.json", "开心.png"]);
    });

    test("图片直接放在根上：没有文件夹名；根上的文件夹忽略", () => {
        const result = unpackZip(zip({"开心.png": PIXEL, "stickers.json": manifest, "别的/图.png": PIXEL}));
        expect(result.ok && result.folder).toBeNull();
        expect(names(result)).toEqual(["stickers.json", "开心.png"]);
    });

    test("macOS 压缩工具带进来的 __MACOSX 与 .DS_Store 忽略，不算路径不合规则", () => {
        const result = unpackZip(zip({"cat/开心.png": PIXEL, "cat/.DS_Store": strToU8("x"), "__MACOSX/cat/._开心.png": strToU8("x")}));
        expect(names(result)).toEqual(["开心.png"]);
    });

    test("没有图片与清单、多个文件夹、读不懂的 zip 不导入", () => {
        expect(reason(unpackZip(zip({"readme.txt": strToU8("x")})))).toContain("没有");
        expect(reason(unpackZip(zip({"a/1.png": PIXEL, "b/2.png": PIXEL})))).toContain("多个文件夹");
        expect(reason(unpackZip(strToU8("这不是 zip，只是一段很长的文字，长到够解压器读出文件头来。".repeat(4))))).not.toBe("");
    });
});

describe("导入的路径与重名", () => {
    test.each([
        ["绝对路径", "/etc/开心.png"],
        ["上一级", "cat/../开心.png"],
        ["以点开头的段", "cat/.hidden/开心.png"],
        ["以点开头的文件", "cat/.开心.png"],
        ["反斜杠", "cat\\开心.png"],
        ["盘符", "C:/开心.png"],
        ["空段", "cat//开心.png"],
    ])("%s：整个 zip 不导入", (_label, path) => {
        expect(reason(unpackZip(zip({[path]: PIXEL, "cat/正常.png": PIXEL})))).toContain("路径不合规则");
    });

    test("同一个文件名出现两次（不分大小写、NFC 等价）：整个不导入", () => {
        expect(reason(unpackZip(zip({"cat/Happy.png": PIXEL, "cat/happy.png": PIXEL})))).toContain("两次");
        expect(reason(unpackZip(zip({"cat/cafe\u0301.png": PIXEL, "cat/caf\u00e9.png": PIXEL})))).toContain("两次");
    });
});

describe("导入的上限按实际解出的字节算", () => {
    const zeros = (megabytes: number): Uint8Array => new Uint8Array(megabytes * 1024 * 1024);

    test("单个文件解开超过 32 MiB：压得很小的 zip 也拒绝", () => {
        const archive = zip({"cat/大.png": zeros(40)});
        expect(archive.length).toBeLessThan(1024 * 1024);
        expect(reason(unpackZip(archive))).toContain("太大");
    });

    // 打 270 MiB 的零字节 zip 要几秒，放宽这一条的超时上限（不是等待：解压本身很快）。
    test("合计解开超过 256 MiB 拒绝", () => {
        const archive = zipSync(Object.fromEntries(Array.from({length: 9}, (_, index) => [`cat/${String(index)}.png`, zeros(30)])), {level: 1});
        expect(archive.length).toBeLessThan(ARCHIVE_LIMITS.archiveBytes);
        expect(reason(unpackZip(archive))).toContain("合计");
    }, 60_000);

    test("条目超过 600 个拒绝（目录项与被忽略的也算）", () => {
        const entries = Object.fromEntries(Array.from({length: ARCHIVE_LIMITS.entries + 1}, (_, index) => [`cat/${String(index)}.txt`, strToU8("x")]));
        expect(reason(unpackZip(zip(entries)))).toContain("条目太多");
    });

    test("zip 本身超过 64 MiB 不读", () => {
        expect(reason(unpackZip(new Uint8Array(ARCHIVE_LIMITS.archiveBytes + 1)))).toContain("64 MiB");
    });
});

describe("包名与导出", () => {
    test("转成合规的包名：小写、非法字符换成连字符、合并、去首尾、至多 60 个字符；转不出为 null", () => {
        expect(packNameFrom("Cat Stickers_v2.zip")).toBe("cat-stickers-v2");
        expect(packNameFrom("--A--B--")).toBe("a-b");
        expect(packNameFrom("猫猫.zip")).toBeNull();
        expect(packNameFrom("a".repeat(80))).toBe("a".repeat(60));
        expect(packNameFrom(`${"a".repeat(59)}-b`)).toBe("a".repeat(59));
    });

    test("导出的 zip 是一个以包名命名的文件夹，导回来文件与字节一样", () => {
        const packed = zipPack("cat", [{name: "stickers.json", bytes: manifest}, {name: "开心.png", bytes: PIXEL}]);
        const back = unpackZip(packed);
        expect(back.ok && back.folder).toBe("cat");
        expect(back.ok && Buffer.from(back.files.get("开心.png") as Uint8Array).equals(Buffer.from(PIXEL))).toBe(true);
        expect(names(back)).toEqual(["stickers.json", "开心.png"]);
    });
});
