/**
 * `./models` 的依赖边界：只依赖内核的公开入口与 OMP 的 pi-ai、pi-catalog、pi-utils（同内核 `model/` 的约束），不引用旧
 * harness 的文件，旧 harness 退役时它原样留下。
 */

import {describe, expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

const ALLOWED = [/^\.\/[a-z-]+\.js$/u, /^\.\.\/kernel\/index\.js$/u, /^@oh-my-pi\/pi-(ai|catalog|utils)(\/[a-z-/]+)?$/u];

describe("./models 的依赖边界", () => {
    test("产品文件只引用同目录、内核公开入口与允许的 OMP 包", () => {
        const offending: string[] = [];
        for (const name of readdirSync(import.meta.dir)) {
            if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
            const text = readFileSync(join(import.meta.dir, name), "utf8");
            for (const match of text.matchAll(/^(?:import|export)\b[^;]*?from\s+"([^"]+)"/gmu)) {
                if (!ALLOWED.some((rule) => rule.test(match[1]!))) offending.push(`${name}: ${match[1]}`);
            }
        }
        expect(offending).toEqual([]);
    });
});
