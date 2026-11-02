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
