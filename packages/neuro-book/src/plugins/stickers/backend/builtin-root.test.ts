/**
 * 找内置表情包的目录（docs/specs/agent/stickers.md 的内置来源与输出 1）：从源码运行、打包后的布局与两处都没有。打包后的真实布局由
 * `scripts/pack-app.test.ts` 解开 tarball 再找一次。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {existsSync} from "node:fs";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {locateBuiltinStickers} from "./builtin-root";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-stickers", "builtin-root");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("内置表情包的目录", () => {
    it("从源码运行：从模块所在目录找到插件源码里的目录，里面是两个内置包", () => {
        const found = locateBuiltinStickers();
        expect(found).toBe(join(import.meta.dir, "..", "builtin"));
        expect(existsSync(join(found as string, "lyra", "stickers.json"))).toBe(true);
        expect(existsSync(join(found as string, "lyra-chibi", "stickers.json"))).toBe(true);
    });

    it("打包后：包根下的 stickers/ 优先；包根两处都没有时为 null，不再往上找", async () => {
        const packed = join(tmp, "packed");
        await mkdir(join(packed, "server"), {recursive: true});
        await mkdir(join(packed, "stickers"), {recursive: true});
        await writeFile(join(packed, "package.json"), "{}");
        expect(locateBuiltinStickers(join(packed, "server"))).toBe(join(packed, "stickers"));

        // 外层有内置目录也不用：找到的第一个包根就是应用自己的。
        const outer = join(tmp, "outer");
        const inner = join(outer, "node_modules", "app");
        await mkdir(join(outer, "stickers"), {recursive: true});
        await writeFile(join(outer, "package.json"), "{}");
        await mkdir(join(inner, "server"), {recursive: true});
        await writeFile(join(inner, "package.json"), "{}");
        expect(locateBuiltinStickers(join(inner, "server"))).toBeNull();
    });
});
