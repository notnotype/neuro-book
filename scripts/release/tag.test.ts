import {spawnSync} from "node:child_process";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {builtVersionProblems, bumpTestVersion, checkReleaseTag, sourceVersion, versionOfTag} from "#scripts/release/tag";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

function git(root: string, ...args: string[]): string {
    const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], {cwd: root, encoding: "utf8"});
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}：${result.stderr}`);
    return result.stdout.trim();
}

/** 一个只有产品版本两处来源的仓库；`master` 是 origin/master 的样子（远端分支的引用直接写）。 */
async function repository(version: {packageJson: string; product: string}): Promise<{root: string; commit: string}> {
    const root = await createTestTmpRoot("release-tag", "release-tag-test");
    roots.push(root);
    const app = join(root, "packages", "neuro-book");
    await mkdir(join(app, "src", "shared"), {recursive: true});
    await writeFile(join(app, "package.json"), `${JSON.stringify({name: "@notnotype/neuro-book", version: version.packageJson}, null, 4)}\n`);
    await writeFile(join(app, "src", "shared", "product.ts"), `/** 产品版本。 */\nexport const PRODUCT_VERSION = "${version.product}";\n`);
    git(root, "init", "--quiet", "--initial-branch=master");
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "release");
    const commit = git(root, "rev-parse", "HEAD");
    git(root, "update-ref", "refs/remotes/origin/master", commit);
    return {root, commit};
}

describe("标签的形状", () => {
    it("v<稳定版本> 取出版本", () => {
        expect(versionOfTag("v0.12.1")).toBe("0.12.1");
        expect(versionOfTag("v10.0.0")).toBe("10.0.0");
    });

    it("带预发布段、构建元数据、前导零、没有 v 或不是三段都拒绝", () => {
        for (const tag of ["v1.0.0-rc.1", "v1.0.0+build", "v01.0.0", "1.0.0", "v1.0", "v0.9.2-canary.20260805.125926Z.39d220b7", "release-1.0.0"]) {
            expect(() => versionOfTag(tag)).toThrow("不是 v<稳定版本>");
        }
    });
});

describe("标签门禁", () => {
    it("标签版本与源码两处版本相同、指向检出的提交、在 origin/master 上：通过", async () => {
        const {root, commit} = await repository({packageJson: "0.12.2", product: "0.12.2"});
        git(root, "tag", "v0.12.2");
        expect(checkReleaseTag({tag: "v0.12.2", head: commit, root})).toEqual({version: "0.12.2"});
    });

    it("附注标签按它指向的提交比较", async () => {
        const {root, commit} = await repository({packageJson: "0.12.2", product: "0.12.2"});
        git(root, "tag", "-a", "v0.12.2", "-m", "NeuroBook 0.12.2");
        expect(checkReleaseTag({tag: "v0.12.2", head: commit, root}).version).toBe("0.12.2");
    });

    it("源码里任一处版本与标签不同：拒绝，指出两处的值", async () => {
        const {root, commit} = await repository({packageJson: "0.12.2", product: "0.12.1"});
        git(root, "tag", "v0.12.2");
        expect(() => checkReleaseTag({tag: "v0.12.2", head: commit, root})).toThrow("PRODUCT_VERSION 是 0.12.1");
    });

    it("标签指向的不是这次检出的提交（推送之后被改指）：拒绝", async () => {
        const {root, commit} = await repository({packageJson: "0.12.2", product: "0.12.2"});
        git(root, "commit", "--quiet", "--allow-empty", "-m", "moved");
        git(root, "tag", "v0.12.2");
        expect(() => checkReleaseTag({tag: "v0.12.2", head: commit, root})).toThrow("不是这次检出的");
    });

    it("本地没有这个标签：拒绝", async () => {
        const {root, commit} = await repository({packageJson: "0.12.2", product: "0.12.2"});
        expect(() => checkReleaseTag({tag: "v0.12.2", head: commit, root})).toThrow("没有标签 v0.12.2");
    });

    it("标签提交不在 origin/master 上（分支上打的标签）：拒绝", async () => {
        const {root} = await repository({packageJson: "0.12.2", product: "0.12.2"});
        git(root, "checkout", "--quiet", "-b", "feature");
        git(root, "commit", "--quiet", "--allow-empty", "-m", "feature");
        git(root, "tag", "v0.12.2");
        const head = git(root, "rev-parse", "HEAD");
        expect(() => checkReleaseTag({tag: "v0.12.2", head, root})).toThrow("不在 origin/master 上");
    });
});

describe("构建出的版本", () => {
    const manifest = (app: string, sdk: string) => ({commit: "a".repeat(40), packages: [
        {name: "@notnotype/nb-ui", version: "0.3.0", tarball: "ui.tgz", sha256: "1"},
        {name: "@notnotype/nb-plugin-sdk", version: sdk, tarball: "sdk.tgz", sha256: "2"},
        {name: "@notnotype/neuro-book", version: app, tarball: "app.tgz", sha256: "3"},
    ]});

    it("应用包、SDK、壳与载荷都是预期版本：通过；源码包的版本不参与", () => {
        expect(builtVersionProblems("0.12.2", {manifest: manifest("0.12.2", "0.12.2"), shell: "0.12.2", payload: "0.12.2"})).toEqual([]);
    });

    it("任一项不同都逐条报出（例如测试包 B′ 的壳没有按新版本重打）", () => {
        const problems = builtVersionProblems("0.12.3", {manifest: manifest("0.12.3", "0.12.2"), shell: "0.12.2", payload: "0.12.3"});
        expect(problems).toHaveLength(2);
        expect(problems[0]).toContain("@notnotype/nb-plugin-sdk 是 0.12.2");
        expect(problems[1]).toContain("bundle/version.json 是 0.12.2");
    });

    it("发布清单里缺应用包或 SDK：报出", () => {
        expect(builtVersionProblems("0.12.2", {manifest: {commit: "a", packages: []}})).toHaveLength(2);
    });
});

describe("演练与测试包的版本", () => {
    it("演练取源码里的版本；两处不一致时拒绝", async () => {
        expect(sourceVersion((await repository({packageJson: "0.12.2", product: "0.12.2"})).root)).toBe("0.12.2");
        const {root} = await repository({packageJson: "0.12.2", product: "0.12.1"});
        expect(() => sourceVersion(root)).toThrow("不一致");
    });

    it("B′ 把两处都改成补丁号加 1，别的内容不动", async () => {
        const {root} = await repository({packageJson: "0.12.9", product: "0.12.9"});
        expect(bumpTestVersion(root)).toBe("0.12.10");
        const app = join(root, "packages", "neuro-book");
        expect(JSON.parse(await readFile(join(app, "package.json"), "utf8"))).toEqual({name: "@notnotype/neuro-book", version: "0.12.10"});
        expect(await readFile(join(app, "src", "shared", "product.ts"), "utf8")).toBe('/** 产品版本。 */\nexport const PRODUCT_VERSION = "0.12.10";\n');
    });
});
