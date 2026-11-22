/**
 * 编译产物的自查（`pack.ts` 构建完调用；纯函数，单测在 `pack-check.test.ts`）。产物坏了而源码没坏的几种情况，在这里拦下：
 * 入口少了导出、纯 TS 的入口拉进了 Vue、包里混进了不该发的文件、随包文字带着 Spec 的条目编号。
 */

/** 一段 ES 模块代码里的静态导入来源（`import … from "x"`、`import "x"`、`export … from "x"`）；压缩过的代码没有空格也认得。 */
export function staticImports(code: string): string[] {
    const found = new Set<string>();
    for (const match of code.matchAll(/(?:\bfrom|\bimport)\s*["']([^"']+)["']/gu)) found.add(match[1]!);
    return [...found];
}

/**
 * 从 `entry` 出发经相对导入能到的所有包名（不是 `./` 开头的来源）。`files` 是产物目录里的文件名到内容；相对导入指向
 * 不在 `files` 里的文件时抛出：产物引用了没生成的块。
 */
export function reachablePackages(files: ReadonlyMap<string, string>, entry: string): string[] {
    const packages = new Set<string>();
    const seen = new Set<string>();
    const queue = [entry];
    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
        if (seen.has(name)) continue;
        seen.add(name);
        const code = files.get(name);
        if (code === undefined) throw new Error(`${name} is imported but missing from the build output`);
        for (const source of staticImports(code)) {
            if (source.startsWith("./")) queue.push(source.slice(2));
            else packages.add(source);
        }
    }
    return [...packages].sort();
}

/** Spec 的条目编号（输出、失败、验收后接数字）：随包的文字不带它们，与包 README 的规则（`src/readme.test.ts`）相同。 */
export function specNumbers(text: string): string[] {
    return [...text.matchAll(/(?:输出|失败|验收) ?[0-9]+/gu)].map((match) => match[0]);
}

/** 产物里不该有的文件：测试、夹具、给 Lab 建索引的入口。 */
export function forbiddenFile(name: string): boolean {
    return /\.test\.|fixtures|lab-sources/u.test(name);
}

/** 两份导出名的差别：`missing` 是源码入口有、产物没有的；`extra` 是产物多出来的。 */
export function exportDiff(expected: readonly string[], actual: readonly string[]): {missing: string[]; extra: string[]} {
    const want = new Set(expected);
    const have = new Set(actual);
    return {missing: [...want].filter((name) => !have.has(name)).sort(), extra: [...have].filter((name) => !want.has(name)).sort()};
}
