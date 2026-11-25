/**
 * 本包的结构守卫：来源地址只在写入口里取（docs/specs/site/telemetry-ingest.md 输出 8）。`clientAddress` 的调用只许出现在
 * `ingest.ts`，那里取到就交给限流器、不写日志；别的文件要来源地址，得先回到这条 Spec 说清它去哪。
 * 守卫按源码文字找调用（`clientAddress(`、`clientAddress?.(`），传递与声明（`clientAddress: …`）不算。规则带反例，证明它拦得下。
 *
 * 它只是提醒，不是“不留来源地址”的防线：它只数直接调用，换个名字（`const where = options.clientAddress; where(c)`）、
 * `.call`、方括号取属性、绕过入口直接读转发头，以及取到之后在 `ingest.ts` 里写进日志，它都看不见；去注释的正则也会把
 * 同一行字符串里 `//` 之后的调用当成注释。真正的防线是合同用例 C13（`nb-site-contract-tests` 的 `telemetry-ingest.test.ts`：
 * 进程的输出与数据目录的文件里找不到来源地址的任何写法），从外面看行为。
 */

import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

const SRC = import.meta.dir;

/** `clientAddress` 被调用的地方；去掉了 `//` 与块注释，注释里提到它不算。 */
function clientAddressCalls(source: string): number {
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
    return [...code.matchAll(/\bclientAddress\s*(?:\?\.)?\s*\(/gu)].length;
}

/** 本包的产品源码：`src` 下除测试与 `testing/` 以外的 `.ts`，路径相对 `src`。 */
function productSources(): string[] {
    return readdirSync(SRC, {recursive: true, encoding: "utf8"})
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.startsWith("testing/"))
        .sort();
}

describe("来源地址只在写入口里取", () => {
    it("clientAddress 只在 ingest.ts 里被调用，且那里确实调用了它", () => {
        const calls = Object.fromEntries(productSources().map((file) => [file, clientAddressCalls(readFileSync(join(SRC, file), "utf8"))]).filter(([, count]) => count !== 0));
        expect(calls).toEqual({"ingest.ts": 1});
    });

    it("反例：调用会被找到，声明、传递与注释里的提及不会", () => {
        expect(clientAddressCalls("const a = options.clientAddress(c);")).toBe(1);
        expect(clientAddressCalls("log(context.clientAddress?.(c));")).toBe(1);
        expect(clientAddressCalls("readonly clientAddress: (c: Context) => string | null;")).toBe(0);
        expect(clientAddressCalls("createIngestApp({clientAddress: options.clientAddress});")).toBe(0);
        expect(clientAddressCalls("// options.clientAddress(c)\n/* clientAddress(c) */")).toBe(0);
    });
});
