import {expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

const SRC = join(import.meta.dir, "..", "src");

function sources(dir: string): string[] {
    return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node" ? [] : sources(path);
        return entry.name.endsWith(".ts") ? [path] : [];
    });
}

test("主入口（src/node 以外）不引用 node:* 与 bun:*，浏览器也能用", () => {
    const offenders = sources(SRC).filter((file) => /from\s+["'](?:node|bun):|import\(\s*["'](?:node|bun):/u.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
});

/** 从一个源文件出发，沿相对导入（含 `import type` 以外的再导出）走到的全部源文件。 */
function closure(entry: string): Set<string> {
    const seen = new Set<string>();
    const visit = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/gmu)) visit(join(file, "..", `${match[1]!}.ts`));
    };
    visit(entry);
    return seen;
}

test("子路径 ./schema 只依赖 TypeBox：不带引擎与渲染", () => {
    const files = [...closure(join(SRC, "schema.ts"))];
    const packages = new Set(files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^."'][^"']*)["']/gmu)].map((match) => match[1]!.split("/")[0]!)));
    expect([...packages].sort()).toEqual(["typebox"]);
    expect(files.map((file) => relative(SRC, file)).filter((file) => file.startsWith("render/") || file.startsWith("engine/"))).toEqual([]);
});
