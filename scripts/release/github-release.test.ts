import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {assetUploads, draftRelease, GitHubReleases, localAssetProblems, previousDesktopRelease, publishRelease, requiredAssets, shouldBeLatest, type ReleaseAsset, type ReleaseSummary, type RunResult} from "#scripts/release/github-release";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

const VERSION = "0.12.2";
const TAG = `v${VERSION}`;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** 一个冻结的资产目录：必有的资产加一个补丁，`SHA256SUMS` 覆盖其余全部。 */
async function assetDirectory(): Promise<{directory: string; digests: Map<string, string>}> {
    const root = await createTestTmpRoot("release-github", "github-release-test");
    roots.push(root);
    const directory = join(root, "release-assets");
    await mkdir(directory);
    const names = [...requiredAssets(VERSION).filter((name) => name !== "SHA256SUMS"), "stable-win-x64-1pgfu5evhc1gh.patch"];
    const digests = new Map<string, string>();
    for (const name of names) {
        await writeFile(join(directory, name), `content of ${name}`);
        digests.set(name, sha256(`content of ${name}`));
    }
    const sums = [...digests].map(([name, digest]) => `${digest}  ${name}`).join("\n") + "\n";
    await writeFile(join(directory, "SHA256SUMS"), sums);
    digests.set("SHA256SUMS", sha256(sums));
    return {directory, digests};
}

/**
 * 替身：按 `gh` 的真实 JSON 形状回答 list 与 view（2026-11-14 对本仓库的旧 Release 取过一次形状），记下每次调用。
 * 写入的调用只记录，并按写入后的样子更新自己的状态。
 */
function fakeGh(initial: {releases: ReleaseSummary[]; assets?: Record<string, ReleaseAsset[]>}) {
    const releases = initial.releases.map((release) => ({...release}));
    const assets: Record<string, ReleaseAsset[]> = {...initial.assets};
    const calls: string[][] = [];
    const ok = (stdout = ""): RunResult => ({code: 0, stdout, stderr: ""});
    const run = async (argv: readonly string[]): Promise<RunResult> => {
        calls.push([...argv]);
        const [, area, verb, tag] = argv;
        if (area !== "release") throw new Error(`替身不认识：${argv.join(" ")}`);
        if (verb === "list") return ok(JSON.stringify(releases));
        if (verb === "view") return ok(JSON.stringify({assets: assets[tag as string] ?? []}));
        if (verb === "create") {
            releases.unshift({tagName: tag as string, isDraft: true, isPrerelease: false, isLatest: false});
            return ok();
        }
        if (verb === "upload") {
            for (const path of argv.slice(4, argv.indexOf("--repo"))) {
                const name = path.split(/[\\/]/).at(-1) as string;
                (assets[tag as string] ??= []).push({name, digest: `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`, state: "uploaded"});
            }
            return ok();
        }
        if (verb === "edit") {
            const release = releases.find((item) => item.tagName === tag);
            if (release === undefined) return {code: 1, stdout: "", stderr: "release not found"};
            if (argv.includes("--draft=false")) release.isDraft = false;
            if (argv.includes("--latest=true") || argv.includes("--latest")) for (const item of releases) item.isLatest = item === release;
            return ok();
        }
        throw new Error(`替身不认识：${argv.join(" ")}`);
    };
    return {github: new GitHubReleases(run, "notnotype/neuro-book"), calls, releases};
}

const OLD_APP: ReleaseSummary = {tagName: "v0.9.2-canary.20260805.125926Z.39d220b7", isDraft: false, isPrerelease: false, isLatest: true};
const silent = () => {};

describe("本地资产目录", () => {
    it("必有的齐全、补丁可有可无、SHA256SUMS 覆盖其余全部：通过", async () => {
        const {digests} = await assetDirectory();
        const sums = [...digests].filter(([name]) => name !== "SHA256SUMS").map(([name, digest]) => `${digest}  ${name}`).join("\n");
        expect(localAssetProblems(VERSION, digests, sums)).toEqual([]);
    });

    it("缺必有的、有不认识的文件、SHA256SUMS 与文件不同或漏列：逐条报出", () => {
        const local = new Map([["win-x64-NeuroBook-Setup.zip", "a".repeat(64)], ["notes.txt", "b".repeat(64)], ["SHA256SUMS", "c".repeat(64)]]);
        const problems = localAssetProblems(VERSION, local, `${"d".repeat(64)}  win-x64-NeuroBook-Setup.zip\n`);
        expect(problems.filter((problem) => problem.includes("缺"))).toHaveLength(4);
        expect(problems).toContain("资产目录里有不认识的文件 notes.txt");
        expect(problems).toContain("SHA256SUMS 里 win-x64-NeuroBook-Setup.zip 的摘要与文件不同");
        expect(problems).toContain("SHA256SUMS 里 notes.txt 的摘要没有列出");
    });
});

describe("只补缺的资产", () => {
    const local = new Map([["a.zip", "1".repeat(64)], ["b.json", "2".repeat(64)]]);

    it("远端没有的上传；同名且摘要相同的不动", () => {
        expect(assetUploads(local, [{name: "a.zip", digest: `sha256:${"1".repeat(64)}`, state: "uploaded"}])).toEqual({upload: ["b.json"], problems: []});
    });

    it("同名摘要不同、没传完、远端多出的：都是问题，不覆盖", () => {
        const {problems} = assetUploads(local, [
            {name: "a.zip", digest: `sha256:${"9".repeat(64)}`, state: "uploaded"},
            {name: "b.json", digest: null, state: "starter"},
            {name: "c.txt", digest: `sha256:${"3".repeat(64)}`, state: "uploaded"},
        ]);
        expect(problems).toHaveLength(3);
        expect(problems[0]).toContain("摘要不同");
        expect(problems[1]).toContain("没有传完");
        expect(problems[2]).toContain("多了本地没有的资产 c.txt");
    });
});

describe("最新与上一版", () => {
    it("本次不低于当前最新才设为最新；当前最新是本次（重跑）也算；旧应用带预发布段的标签可比较", () => {
        expect(shouldBeLatest(VERSION, null)).toBe(true);
        expect(shouldBeLatest(VERSION, OLD_APP.tagName)).toBe(true);
        expect(shouldBeLatest(VERSION, TAG)).toBe(true);
        expect(shouldBeLatest("0.12.1", TAG)).toBe(false);
    });

    it("上一版：低于本次、公开、稳定标签、有 Setup 资产的最高版本；与哪个是最新无关", async () => {
        const releases: ReleaseSummary[] = [
            {tagName: "v0.13.0", isDraft: false, isPrerelease: false, isLatest: true},
            {tagName: TAG, isDraft: false, isPrerelease: false, isLatest: false},
            {tagName: "v0.12.1", isDraft: true, isPrerelease: false, isLatest: false},
            {tagName: "v0.12.0", isDraft: false, isPrerelease: false, isLatest: false},
            {tagName: "v0.11.0", isDraft: false, isPrerelease: false, isLatest: false},
            OLD_APP,
        ];
        const withSetup = new Set(["v0.11.0", "v0.13.0"]);
        expect(await previousDesktopRelease(VERSION, releases, async (tag) => withSetup.has(tag))).toBe("v0.11.0");
        expect(await previousDesktopRelease(VERSION, [OLD_APP], async () => true)).toBeNull();
    });
});

describe("草稿与公开", () => {
    it("第一次：建草稿（--verify-tag）、上传全部资产；公开时一个请求里公开并设为最新", async () => {
        const {directory} = await assetDirectory();
        const {github, calls, releases} = fakeGh({releases: [OLD_APP]});
        await draftRelease(github, VERSION, directory, silent);
        const create = calls.find((call) => call[2] === "create") as string[];
        expect(create).toContain("--draft");
        expect(create).toContain("--verify-tag");
        expect(calls.find((call) => call[2] === "upload")?.filter((arg) => arg.startsWith(directory))).toHaveLength(7);

        expect(await publishRelease(github, VERSION, directory, silent)).toEqual({latest: true});
        const edits = calls.filter((call) => call[2] === "edit");
        expect(edits).toHaveLength(1);
        expect(edits[0]).toEqual(expect.arrayContaining(["--draft=false", "--latest=true"]));
        expect(releases.find((release) => release.isLatest)?.tagName).toBe(TAG);
    });

    it("重跑草稿：只传缺的；同名资产摘要不同就失败、不上传", async () => {
        const {directory, digests} = await assetDirectory();
        const setup = {name: "win-x64-NeuroBook-Setup.zip", digest: `sha256:${digests.get("win-x64-NeuroBook-Setup.zip")}`, state: "uploaded"};
        const partial = fakeGh({releases: [{tagName: TAG, isDraft: true, isPrerelease: false, isLatest: false}], assets: {[TAG]: [setup]}});
        await draftRelease(partial.github, VERSION, directory, silent);
        expect(partial.calls.some((call) => call[2] === "create")).toBe(false);
        expect(partial.calls.find((call) => call[2] === "upload")?.some((arg) => arg.endsWith("Setup.zip"))).toBe(false);

        const wrong = fakeGh({releases: [{tagName: TAG, isDraft: true, isPrerelease: false, isLatest: false}], assets: {[TAG]: [{...setup, digest: `sha256:${"0".repeat(64)}`}]}});
        await expect(draftRelease(wrong.github, VERSION, directory, silent)).rejects.toThrow("摘要不同");
        expect(wrong.calls.some((call) => call[2] === "upload")).toBe(false);
    });

    it("补发旧版本：公开时不设为最新，当前最新不变", async () => {
        const {directory} = await assetDirectory();
        const {github, calls, releases} = fakeGh({releases: [{tagName: "v0.13.0", isDraft: false, isPrerelease: false, isLatest: true}]});
        await draftRelease(github, VERSION, directory, silent);
        expect(await publishRelease(github, VERSION, directory, silent)).toEqual({latest: false});
        expect(calls.find((call) => call[2] === "edit")).toEqual(expect.arrayContaining(["--draft=false", "--latest=false"]));
        expect(releases.find((release) => release.isLatest)?.tagName).toBe("v0.13.0");
    });

    it("公开成功后作业失败、重跑：已是最新的只核对，不发请求、不撤最新", async () => {
        const {directory} = await assetDirectory();
        const {github, calls} = fakeGh({releases: [OLD_APP]});
        await draftRelease(github, VERSION, directory, silent);
        await publishRelease(github, VERSION, directory, silent);
        const before = calls.length;
        await draftRelease(github, VERSION, directory, silent);
        expect(await publishRelease(github, VERSION, directory, silent)).toEqual({latest: true});
        expect(calls.slice(before).filter((call) => ["create", "upload", "edit"].includes(call[2] as string))).toEqual([]);
    });

    it("已公开但没设上最新（上一次只落了一半）：补设最新", async () => {
        const {directory} = await assetDirectory();
        const {github, calls, releases} = fakeGh({releases: [OLD_APP]});
        await draftRelease(github, VERSION, directory, silent);
        (releases.find((release) => release.tagName === TAG) as ReleaseSummary).isDraft = false;
        await publishRelease(github, VERSION, directory, silent);
        expect(calls.filter((call) => call[2] === "edit").at(-1)).toEqual(expect.arrayContaining(["--latest"]));
        expect(releases.find((release) => release.isLatest)?.tagName).toBe(TAG);
    });

    it("没有草稿就公开、或还缺资产：失败", async () => {
        const {directory} = await assetDirectory();
        await expect(publishRelease(fakeGh({releases: [OLD_APP]}).github, VERSION, directory, silent)).rejects.toThrow("先跑 draft");
        const empty = fakeGh({releases: [{tagName: TAG, isDraft: true, isPrerelease: false, isLatest: false}]});
        await expect(publishRelease(empty.github, VERSION, directory, silent)).rejects.toThrow("还缺资产");
    });
});
