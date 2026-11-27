import {expect, test} from "bun:test";
import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

const SRC = join(import.meta.dir, "..", "src");

function sources(dir: string): string[] {
    return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const path = join(dir, entry.name);
        // `node/` 与 `sample/` 是只在 Bun、Node 里用的子路径（`./node`、`./sample`），不经主入口。
        if (entry.isDirectory()) return entry.name === "node" || entry.name === "sample" ? [] : sources(path);
        return entry.name.endsWith(".ts") ? [path] : [];
    });
}

test("主入口（src/node 与 src/sample 以外）不引用 node:* 与 bun:*，浏览器也能用", () => {
    const offenders = sources(SRC).filter((file) => /from\s+["'](?:node|bun):|import\(\s*["'](?:node|bun):/u.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => relative(SRC, file))).toEqual([]);
    // 主入口与 ./schema 走不到 sample/：样本只经它自己的子路径。
    expect([...closure(join(SRC, "index.ts")), ...closure(join(SRC, "schema.ts"))].map((file) => relative(SRC, file)).filter((file) => file.startsWith("sample/"))).toEqual([]);
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

test("子路径 ./grammar 运行时只依赖 nb-markdown 的纯入口 ./marked 与 acorn：浏览器的编辑器与阅读视图也引它，不带 Tiptap", () => {
    const files = [...closure(join(SRC, "grammar", "index.ts"))];
    const specifiers = new Set(files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^."'][^"']*)["']/gmu)].map((match) => match[1]!)));
    expect([...specifiers].sort()).toEqual(["@notnotype/nb-markdown/marked", "acorn"]);
    expect(files.map((file) => relative(SRC, file)).filter((file) => !file.startsWith("grammar/") && !file.startsWith("core/"))).toEqual([]);
});
