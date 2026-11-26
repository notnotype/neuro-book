import {spawnSync} from "node:child_process";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import {afterEach, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PRODUCT_PACKAGES, VERSIONED_DIRECTORIES, versionedPackage} from "./packages";

// 检查要用 Bun 的转译器扫导入，测试在 Node 里跑，所以经子进程跑真实的命令。
const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPOSITORY, "scripts", "release", "packages.ts");
const LICENSE_TEXT = "license text\n";

type CheckOutput = {ok: boolean; findings: {package: string; code: string; message: string}[]; order: string[]};

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

function runCheck(args: readonly string[]): {status: number | null; output: CheckOutput} {
    const result = spawnSync("bun", [SCRIPT, "--json", ...args], {encoding: "utf8"});
    return {status: result.status, output: JSON.parse(result.stdout) as CheckOutput};
}

function manifest(dir: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: `@notnotype/${dir}`,
        version: "0.1.0",
        license: "AGPL-3.0-only",
        repository: {type: "git", url: "git+https://github.com/notnotype/neuro-book.git", directory: `packages/${dir}`},
        publishConfig: {access: "public"},
        type: "module",
        engines: {bun: ">=1.3.14"},
        files: ["src", "!src/**/*.test.ts", "README.md", "LICENSE"],
        ...extra,
    };
}

async function writePackage(root: string, dir: string, packageJson: Record<string, unknown>, files: Record<string, string>): Promise<void> {
    const path = join(root, "packages", dir);
    await mkdir(path, {recursive: true});
    await writeFile(join(path, "package.json"), JSON.stringify(packageJson));
    await writeFile(join(path, "LICENSE"), LICENSE_TEXT);
    await writeFile(join(path, "README.md"), "# readme\n");
    for (const [file, content] of Object.entries(files)) {
        await mkdir(dirname(join(path, file)), {recursive: true});
        await writeFile(join(path, file), content);
    }
}

async function fixtureRoot(): Promise<string> {
    const root = await createTestTmpRoot("release-packages", "release-packages-test");
    roots.push(root);
    await writeFile(join(root, "LICENSE"), LICENSE_TEXT);
    return root;
}

describe("发布清单检查", () => {
    it("本仓库的发布清单通过检查，按依赖顺序排出 10 个包", () => {
        const {status, output} = runCheck([]);

        expect(output.findings).toEqual([]);
        expect(status).toBe(0);
        expect(output.order).toHaveLength(10);
        expect(output.order.indexOf("@notnotype/nb-ui")).toBeLessThan(output.order.indexOf("@notnotype/nb-agent-ui"));
        expect(output.order.indexOf("@notnotype/nb-harness")).toBeLessThan(output.order.indexOf("@notnotype/nb-story"));
        expect(output.order.at(-1)).toBe("@notnotype/nb-story");
    });

    it("bun.lock 里记的工作区版本与 package.json 不同时报出（发布时依赖范围会被写旧）", async () => {
        const root = await fixtureRoot();
        await writePackage(root, "lib", manifest("lib", {version: "0.2.0"}), {"src/index.ts": "export const x = 1;\n"});
        await writeFile(join(root, "bun.lock"), `{\n  "workspaces": {\n    "packages/lib": {\n      "name": "@notnotype/lib",\n      "version": "0.1.0",\n    },\n  },\n}\n`);

        const stale = runCheck(["--root", root, "--package", "lib"]);
        expect(stale.status).toBe(1);
        expect(stale.output.findings.map((finding) => finding.code)).toEqual(["lockfile_version"]);

        await writeFile(join(root, "bun.lock"), `{\n  "workspaces": {\n    "packages/lib": {\n      "name": "@notnotype/lib",\n      "version": "0.2.0",\n    },\n  },\n}\n`);
        expect(runCheck(["--root", root, "--package", "lib"]).status).toBe(0);
    });

    it("被依赖的包排在前面", async () => {
        const root = await fixtureRoot();
        await writePackage(root, "app", manifest("app", {dependencies: {"@notnotype/base": "workspace:^"}}), {"src/index.ts": `import {base} from "@notnotype/base";\nexport const app = base;\n`});
        await writePackage(root, "base", manifest("base"), {"src/index.ts": "export const base = 1;\n"});

        const {status, output} = runCheck(["--root", root, "--package", "app", "--package", "base"]);

        expect(output.findings).toEqual([]);
        expect(status).toBe(0);
        expect(output.order).toEqual(["@notnotype/base", "@notnotype/app"]);
    });

    it("发布的源码值导入了没写进依赖的包时报出，含单文件组件的样式与 JSX 文件自己写的 react；测试文件、只有类型的导入、JSX 补出的 react 不算", async () => {
        const root = await fixtureRoot();
        await writePackage(root, "lib", manifest("lib", {dependencies: {declared: "^1.0.0"}, devDependencies: {devonly: "^1.0.0", "@notnotype/test-support": "workspace:*"}}), {
            "src/index.ts": [
                `import {a} from "declared/sub";`,
                `import type {B} from "typeonly";`,
                `import {c} from "devonly";`,
                `import {readFileSync} from "fs";`,
                `export const x = [a, c, readFileSync, await import("@scope/dynamic/deep")];`,
                `export type Y = B;`,
            ].join("\n"),
            "src/index.test.ts": `import {t} from "testonly";\nexport const z = t;\n`,
            "src/view.vue": `<template><div /></template>\n<script setup lang="ts">\nimport {ref} from "vue";\n</script>\n<style>\n@import "styledep/theme.css";\n</style>\n`,
            "src/style.css": `/* @plugin "commented"; */\n@import "declared/style.css";\n@plugin "tailwind-plugin";\n`,
            "src/profile.tsx": `/** @jsxImportSource declared */\nexport const p = <section />;\n`,
            "src/explicit.tsx": `/** @jsxImportSource declared */\nimport "react";\nexport const e = <section />;\n`,
        });

        const {status, output} = runCheck(["--root", root, "--package", "lib"]);
        const missing = output.findings.filter((finding) => finding.code === "undeclared_import").map((finding) => finding.message.split("（")[0]);

        expect(status).toBe(1);
        expect(missing.sort()).toEqual(["@scope/dynamic", "devonly", "react", "styledep", "tailwind-plugin", "vue"]);
    });

    it("只用 JSX 的文件：要求声明 pragma 指定的运行时，不要求 react", async () => {
        const root = await fixtureRoot();
        const source = `/** @jsxImportSource @notnotype/runtime */\nconst props = {};\nexport const p = <section {...props} />;\n`;
        await writePackage(root, "jsx", manifest("jsx", {dependencies: {"@notnotype/runtime": "workspace:^"}}), {"src/profile.tsx": source});
        await writePackage(root, "runtime", manifest("runtime"), {"src/index.ts": "export {};\n"});
        await writePackage(root, "bare", manifest("bare"), {"src/profile.tsx": source});

        const declared = runCheck(["--root", root, "--package", "jsx", "--package", "runtime"]);
        const bare = runCheck(["--root", root, "--package", "bare"]);

        expect(declared.output.findings).toEqual([]);
        expect(bare.output.findings.map((finding) => finding.message.split("（")[0])).toEqual(["@notnotype/runtime"]);
    });

    it("没去掉 private、LICENSE 与仓库根不同、内部依赖没写 workspace:^ 时逐条报出", async () => {
        const root = await fixtureRoot();
        await writePackage(root, "base", manifest("base"), {"src/index.ts": "export const base = 1;\n"});
        await writePackage(root, "app", manifest("app", {private: true, publishConfig: undefined, dependencies: {"@notnotype/base": "workspace:*", "@notnotype/unlisted": "workspace:^"}}), {
            "src/index.ts": `import "@notnotype/base";\nimport "@notnotype/unlisted";\n`,
        });
        await writeFile(join(root, "packages", "app", "LICENSE"), "other license\n");

        const {status, output} = runCheck(["--root", root, "--package", "app", "--package", "base"]);
        const codes = output.findings.filter((finding) => finding.package === "@notnotype/app").map((finding) => finding.code);

        expect(status).toBe(1);
        expect(codes.sort()).toEqual(["internal_dependency", "internal_dependency", "license_file", "private", "publish_config"]);
        expect(output.findings.filter((finding) => finding.package === "@notnotype/base")).toEqual([]);
    });

    it("未知参数退出 2", () => {
        const result = spawnSync("bun", [SCRIPT, "--bogus"], {encoding: "utf8"});

        expect(result.status).toBe(2);
        expect(result.stderr).toContain("--bogus");
    });
});

describe("生成包：版本独立、MIT（ADR 0054 第 5、6 条，nb-layout）", () => {
    /** 用一个 Bun 子进程跑检查：源码包 `app`，加一个版本独立、MIT 的生成包 `lib`（生成目录 `dist/package`）。 */
    function checkWithBuilt(root: string): CheckOutput["findings"] {
        const built = {name: "@notnotype/lib", source: "lib", script: "build", outDir: "dist/package", repositoryDirectory: "packages/lib", version: "own", license: "MIT", bun: false};
        const code = `import {checkReleasePackages, loadBuiltPackages, loadReleasePackages} from ${JSON.stringify(SCRIPT)};
const root = ${JSON.stringify(root)};
console.log(JSON.stringify(checkReleasePackages(root, [...loadReleasePackages(root, ["app"]), ...loadBuiltPackages(root, [${JSON.stringify(built)}])])));`;
        const result = spawnSync("bun", ["-e", code], {encoding: "utf8"});
        if (result.status !== 0) throw new Error(result.stderr);
        return JSON.parse(result.stdout) as CheckOutput["findings"];
    }

    async function writeBuilt(root: string, extra: Record<string, unknown>): Promise<void> {
        const path = join(root, "packages", "lib", "dist", "package");
        await mkdir(path, {recursive: true});
        await writeFile(join(path, "package.json"), JSON.stringify({...manifest("lib", {license: "MIT", engines: undefined, files: ["*.js", "README.md", "LICENSE"]}), ...extra}));
        await writeFile(join(path, "LICENSE"), "MIT License\n\nCopyright (c) 2026 notnotype\n");
        await writeFile(join(path, "README.md"), "# lib\n");
        await writeFile(join(path, "index.js"), "export const lib = 1;\n");
    }

    it("产品版本的只有应用与 SDK；版本手工提的目录有源码包与 nb-layout", () => {
        expect([...PRODUCT_PACKAGES].sort()).toEqual(["@notnotype/nb-plugin-sdk", "@notnotype/neuro-book"]);
        expect(VERSIONED_DIRECTORIES).toEqual(expect.arrayContaining(["nb-story", "nb-runtime", "nb-layout"]));
    });

    it("发版准备与 Release 说明：现在是 private 的不看；上一个标签下是 private 的按新包", () => {
        expect(versionedPackage({version: "0.1.0", private: true}, {version: "0.1.0", private: true})).toBeNull();
        expect(versionedPackage({version: "0.1.0"}, {version: "0.1.0", private: true})).toEqual({version: "0.1.0", previousVersion: null});
        expect(versionedPackage({version: "0.2.0"}, {version: "0.1.0"})).toEqual({version: "0.2.0", previousVersion: "0.1.0"});
        expect(versionedPackage({version: "0.1.0"}, null)).toEqual({version: "0.1.0", previousVersion: null});
    });

    it("MIT 的生成包：LICENSE 不与仓库根比、不要求 engines.bun；还是 private 时不报、也不算发布的包", async () => {
        const root = await fixtureRoot();
        await writePackage(root, "app", manifest("app", {devDependencies: {"@notnotype/lib": "workspace:*"}}), {"src/index.ts": "export const app = 1;\n"});
        await writeBuilt(root, {private: true});
        expect(checkWithBuilt(root)).toEqual([]);

        // 首发之后（去掉 private）：它是发布的包了，内部依赖要写 workspace:^，哪怕是 devDependencies。
        await writeBuilt(root, {});
        expect(checkWithBuilt(root).map((finding) => `${finding.package} ${finding.code}`)).toEqual(["@notnotype/app internal_dependency"]);
    });

    it("只查源码包时（release:check 与 release:publish 的闸门）：发布依赖可以指向已首发的生成包，要写 workspace:^；首发之前的不行", async () => {
        const built = {name: "@notnotype/lib", source: "lib", script: "build", outDir: "dist/package", repositoryDirectory: "packages/lib", version: "own", license: "MIT", bun: false};
        /** 只载源码包 `app`，生成包只按源码目录的清单认名字（生成目录不存在也行）。 */
        const checkSourcesOnly = (root: string): string[] => {
            const code = `import {checkReleasePackages, loadReleasePackages, releasedBuiltNames} from ${JSON.stringify(SCRIPT)};
const root = ${JSON.stringify(root)};
console.log(JSON.stringify(checkReleasePackages(root, loadReleasePackages(root, ["app"]), releasedBuiltNames(root, [${JSON.stringify(built)}]))));`;
            const result = spawnSync("bun", ["-e", code], {encoding: "utf8"});
            if (result.status !== 0) throw new Error(result.stderr);
            return (JSON.parse(result.stdout) as CheckOutput["findings"]).map((finding) => `${finding.package} ${finding.code}`);
        };
        const root = await fixtureRoot();
        const app = (spec: string) => writePackage(root, "app", manifest("app", {dependencies: {"@notnotype/lib": spec}}), {"src/index.ts": `import {lib} from "@notnotype/lib";\nexport const app = lib;\n`});

        // 源码目录还不在：不认这个名字。
        await app("workspace:^");
        expect(checkSourcesOnly(root)).toEqual(["@notnotype/app internal_dependency"]);

        await mkdir(join(root, "packages", "lib"), {recursive: true});
        await writeFile(join(root, "packages", "lib", "package.json"), JSON.stringify({name: "@notnotype/lib", version: "0.1.0", private: true}));
        expect(checkSourcesOnly(root)).toEqual(["@notnotype/app internal_dependency"]);

        await writeFile(join(root, "packages", "lib", "package.json"), JSON.stringify({name: "@notnotype/lib", version: "0.1.0"}));
        expect(checkSourcesOnly(root)).toEqual([]);

        await app("workspace:*");
        expect(checkSourcesOnly(root)).toEqual(["@notnotype/app internal_dependency"]);
    });

    it("本仓库：只载源码包、不另传名字时，nb-agent-ui 对 nb-layout 的发布依赖通过（release:publish 的闸门这样调用）", () => {
        const code = `import {checkReleasePackages, loadReleasePackages} from ${JSON.stringify(SCRIPT)};
const root = ${JSON.stringify(REPOSITORY)};
console.log(JSON.stringify(checkReleasePackages(root, loadReleasePackages(root))));`;
        const result = spawnSync("bun", ["-e", code], {encoding: "utf8"});
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual([]);
    });

    it("MIT 的生成包换成了别的许可文本、license 写错：报出", async () => {
        const root = await fixtureRoot();
        await writePackage(root, "app", manifest("app"), {"src/index.ts": "export const app = 1;\n"});
        await writeBuilt(root, {license: "AGPL-3.0-only"});
        await writeFile(join(root, "packages", "lib", "dist", "package", "LICENSE"), LICENSE_TEXT);
        expect(checkWithBuilt(root).map((finding) => finding.code).sort()).toEqual(["license", "license_file"]);
    });
});
