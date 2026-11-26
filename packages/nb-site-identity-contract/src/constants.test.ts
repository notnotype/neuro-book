/**
 * `./constants` 入口不带 TypeBox 的运行时（见 `constants.ts` 的文件头）：顺着它的运行时导入（不算 `import type`、`export type`）
 * 走遍能到的本包文件，没有一个导入 `typebox`。转出的值与包入口的是同一批，前端从哪个入口取都一样。
 */

import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join, resolve} from "node:path";

import * as constants from "./constants";
import * as contract from "./index";

const SOURCE = import.meta.dir;

/** 一份源码里运行时的导入与转出的说明符：`import type`、`export type` 编译后不留下，不算。 */
function runtimeSpecifiers(text: string): string[] {
    return [...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+"([^"]+)"/gmu)].map((match) => match[1]!);
}

/** 从 `entry` 出发经运行时导入能到的本包文件，与它们导入的包外说明符。 */
function reach(entry: string): {readonly files: string[]; readonly external: string[]} {
    const files: string[] = [];
    const external = new Set<string>();
    const pending = [entry];
    while (pending.length > 0) {
        const file = pending.pop()!;
        if (files.includes(file)) continue;
        files.push(file);
        for (const specifier of runtimeSpecifiers(readFileSync(file, "utf8"))) {
            if (specifier.startsWith(".")) pending.push(`${resolve(SOURCE, specifier)}.ts`);
            else external.add(specifier);
        }
    }
    return {files: files.map((file) => file.slice(SOURCE.length + 1)).sort(), external: [...external]};
}

describe("constants 入口", () => {
    it("经运行时导入能到的文件都不导入 TypeBox，也不导入写 schema 的工具", () => {
        const {files, external} = reach(join(SOURCE, "constants.ts"));
        expect(external).toEqual([]);
        expect(files).not.toContain("schema.ts");
        expect(files).toContain("path-constants.ts");
    });

    it("反例：带 schema 的模块经运行时导入会被认出来", () => {
        expect(reach(join(SOURCE, "fields.ts")).external).toEqual(["typebox"]);
        expect(runtimeSpecifiers('import type {Static} from "typebox";\nexport type * from "./account";')).toEqual([]);
    });

    it("转出的每个值与包入口的是同一个", () => {
        const values = Object.entries(constants);
        expect(values.length).toBeGreaterThan(0);
        for (const [name, value] of values) expect({name, same: (contract as Record<string, unknown>)[name] === value}).toEqual({name, same: true});
    });
});
