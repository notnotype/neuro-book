import {describe, expect, it} from "vitest";

import {buildReleasePlan, distTagFor, parseLatestTag, parseRegistryVersion, planManifestProblems, publishSteps, type PlanInput, type RegistryVersion} from "#scripts/release/release-plan";
import {compareVersions} from "#scripts/release/semver";

const COMMIT = "c".repeat(40);
// 标签提交的提交时间；早于它发布的是历史包，晚于它的只可能是这次发布的前一轮发的。
const COMMIT_TIME = "2026-11-14T10:00:00+00:00";
const BEFORE = "2026-10-29T09:45:10.633Z";
const AFTER = "2026-11-14T10:20:00.000Z";

const APP = "@notnotype/neuro-book";
const SDK = "@notnotype/nb-plugin-sdk";

function input(registry: Record<string, RegistryVersion>, dependencies: Record<string, string[]> = {}): PlanInput {
    const names = Object.keys(registry);
    return {
        manifest: {commit: COMMIT, packages: names.map((name, index) => ({name, version: name === APP || name === SDK ? "0.12.2" : "0.3.0", tarball: `p${index}.tgz`, sha256: `s${index}`}))},
        commitTime: COMMIT_TIME,
        productPackages: new Set([APP, SDK]),
        integrityOf: new Map(names.map((name) => [name, `sha512-${name}`])),
        dependenciesOf: new Map(names.map((name) => [name, dependencies[name] ?? []])),
        registry: new Map(Object.entries(registry)),
    };
}

const unpublished: RegistryVersion = {state: "unpublished"};
const same = (name: string, publishedAt: string): RegistryVersion => ({state: "published", integrity: `sha512-${name}`, publishedAt});
const different = (publishedAt: string): RegistryVersion => ({state: "published", integrity: "sha512-other", publishedAt});

describe("发布计划：本次发布与历史包", () => {
    it("registry 上没有的版本是本次发布、要发；早就发过且字节相同的是历史包", () => {
        const {plan, problems} = buildReleasePlan(input({"@x/ui": same("@x/ui", BEFORE), [APP]: unpublished}));
        expect(problems).toEqual([]);
        expect(plan.packages.map((entry) => [entry.name, entry.kind, entry.registry])).toEqual([["@x/ui", "history", "same"], [APP, "release", "unpublished"]]);
        expect(plan).toMatchObject({schema: "nbook.release-plan/v1", commit: COMMIT, commitTime: COMMIT_TIME});
    });

    it("早就发过、源码改了没提版本号（字节不同）、没人依赖：历史包，只提醒，不拦", () => {
        const {plan, problems} = buildReleasePlan(input({"@x/ui": different(BEFORE), [APP]: unpublished}));
        expect(problems).toEqual([]);
        expect(plan.packages[0]).toMatchObject({kind: "history", registry: "different"});
    });

    it("标签提交之后发的（前一轮发了一半）、字节相同：本次发布，已发，计划照写", () => {
        const {plan, problems} = buildReleasePlan(input({"@x/flock": same("@x/flock", AFTER), [APP]: unpublished}));
        expect(problems).toEqual([]);
        expect(plan.packages[0]).toMatchObject({kind: "release", registry: "same"});
    });

    it("整轮重跑：前一轮发的源码包与这一轮打的字节不同：失败（不能当历史包放过）", () => {
        const {problems} = buildReleasePlan(input({"@x/flock": different(AFTER), [APP]: unpublished}));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("@x/flock@0.3.0");
        expect(problems[0]).toContain("字节不同");
    });

    it("应用包与 SDK 不会是历史包：同版本已在 registry 上而字节不同就失败，桌面载荷与 npm 上的会不是一批", () => {
        const {problems} = buildReleasePlan(input({[SDK]: same(SDK, BEFORE), [APP]: different(BEFORE)}));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain(`${APP}@0.12.2`);
    });

    it("本次发布的包依赖字节不同的历史包：失败", () => {
        const {problems} = buildReleasePlan(input({"@x/runtime": different(BEFORE), "@x/story": unpublished}, {"@x/story": ["@x/runtime"]}));
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain("@x/runtime");
    });

    it("运行时依赖写进计划：发布作业里没有生成目录，读不到它们", () => {
        const {plan} = buildReleasePlan(input({"@x/runtime": unpublished, "@x/story": unpublished}, {"@x/story": ["@x/runtime"]}));
        expect(plan.packages[1]?.dependencies).toEqual(["@x/runtime"]);
    });
});

describe("发布作业按计划发", () => {
    it("跨入口：计划收下字节不同的历史包之后，发布作业照常发本次发布的包，不发、不拦历史包", () => {
        const {plan, problems} = buildReleasePlan(input({"@x/ui": different(BEFORE), [SDK]: unpublished, [APP]: unpublished}));
        expect(problems).toEqual([]);
        const steps = publishSteps(plan, new Map([[SDK, unpublished], [APP, unpublished]]));
        expect(steps.problems).toEqual([]);
        expect(steps.publish.map((entry) => entry.name)).toEqual([SDK, APP]);
    });

    it("重跑：已发且字节相同的跳过，接着发没发的", () => {
        const {plan} = buildReleasePlan(input({[SDK]: unpublished, [APP]: unpublished}));
        const steps = publishSteps(plan, new Map([[SDK, same(SDK, AFTER)], [APP, unpublished]]));
        expect(steps.skip.map((entry) => entry.name)).toEqual([SDK]);
        expect(steps.publish.map((entry) => entry.name)).toEqual([APP]);
    });

    it("写计划之后别处发了另一份字节：停下", () => {
        const {plan} = buildReleasePlan(input({[SDK]: unpublished, [APP]: unpublished}));
        const steps = publishSteps(plan, new Map([[SDK, different(AFTER)], [APP, unpublished]]));
        expect(steps.problems).toHaveLength(1);
        expect(steps.problems[0]).toContain(SDK);
    });
});

describe("计划与发布清单、tarball 对得上", () => {
    const {plan} = buildReleasePlan(input({"@x/ui": unpublished, [APP]: unpublished}));
    const manifest = input({"@x/ui": unpublished, [APP]: unpublished}).manifest;
    const digests = new Map([["p0.tgz", "s0"], ["p1.tgz", "s1"]]);

    it("同一个提交、同一批 tarball：通过", () => {
        expect(planManifestProblems(plan, manifest, digests)).toEqual([]);
    });

    it("提交不同、条目对不上、tarball 被换过或不在、包数不同：逐条报出", () => {
        expect(planManifestProblems(plan, {...manifest, commit: "d".repeat(40)}, digests)[0]).toContain("提交");
        expect(planManifestProblems(plan, {...manifest, packages: [manifest.packages[0]!, {...manifest.packages[1]!, sha256: "x"}]}, digests)[0]).toContain("对不上");
        expect(planManifestProblems(plan, manifest, new Map([["p0.tgz", "s0"]]))[0]).toContain("p1.tgz");
        expect(planManifestProblems(plan, {...manifest, packages: [...manifest.packages, {name: "@x/extra", version: "1.0.0", tarball: "e.tgz", sha256: "e"}]}, digests)).toContain("发布计划有 2 个包，发布清单有 3 个");
    });
});

describe("dist-tag", () => {
    it("从没发过或高于当前 latest：latest；等于或低于：history（补发旧版本不往回拨）", () => {
        expect(distTagFor("0.1.0", null)).toBe("latest");
        expect(distTagFor("0.12.2", "0.12.1")).toBe("latest");
        expect(distTagFor("0.12.1", "0.12.2")).toBe("history");
        expect(distTagFor("0.12.2", "0.12.2")).toBe("history");
    });

    it("latest 被手工回拨、不是最高版本时仍按 latest 判断，并显式给出标签（不带 --tag 时 npm 按最高版本拒绝）", () => {
        // registry 上有 0.11.2，latest 回拨到 0.11.0；补发 0.11.1 高于 latest。
        expect(distTagFor("0.11.1", "0.11.0")).toBe("latest");
    });

    it("latest 是预发布版本时，正式版本高于它", () => {
        expect(distTagFor("0.0.1", "0.0.0-stage")).toBe("latest");
    });
});

// 下面的输出是 2026-11-14 对 registry.npmjs.org 实际取的：npm 12 把结果打成只有一项的数组，npm 10 打成值。
const NOT_FOUND = JSON.stringify({error: {code: "E404", summary: "No match found for version 9.9.9"}});
const VIEW_NPM12 = JSON.stringify([{"dist.integrity": "sha512-rKMz", time: {created: "2026-10-24T09:47:42.405Z", "0.3.0": "2026-10-29T09:45:10.633Z"}}]);

describe("读 registry", () => {
    it("某个版本：npm 12 与 npm 10 两种形状都读出摘要与发布时间；E404 算没发布", () => {
        expect(parseRegistryVersion({code: 0, stdout: VIEW_NPM12}, "0.3.0")).toEqual({state: "published", integrity: "sha512-rKMz", publishedAt: "2026-10-29T09:45:10.633Z"});
        expect(parseRegistryVersion({code: 0, stdout: JSON.stringify(JSON.parse(VIEW_NPM12)[0])}, "0.3.0").state).toBe("published");
        expect(parseRegistryVersion({code: 1, stdout: NOT_FOUND}, "9.9.9")).toEqual({state: "unpublished"});
    });

    it("网络、权限失败与读不懂的输出都抛出，不当成没发布", () => {
        expect(() => parseRegistryVersion({code: 1, stdout: JSON.stringify({error: {code: "E403"}})}, "0.3.0")).toThrow("E403");
        expect(() => parseRegistryVersion({code: 1, stdout: "npm error"}, "0.3.0")).toThrow("不是 JSON");
        expect(() => parseRegistryVersion({code: 0, stdout: ""}, "0.3.0")).toThrow("不是 JSON");
        expect(() => parseRegistryVersion({code: 0, stdout: VIEW_NPM12}, "0.4.0")).toThrow("time.0.4.0");
    });

    it("latest：两种形状都读出；包不存在或没有 latest 为 null；别的失败抛出", () => {
        expect(parseLatestTag({code: 0, stdout: `[\n  "0.3.0"\n]\n`})).toBe("0.3.0");
        expect(parseLatestTag({code: 0, stdout: `"0.3.0"\n`})).toBe("0.3.0");
        expect(parseLatestTag({code: 1, stdout: JSON.stringify({error: {code: "E404"}})})).toBeNull();
        expect(parseLatestTag({code: 0, stdout: ""})).toBeNull();
        expect(() => parseLatestTag({code: 1, stdout: JSON.stringify({error: {code: "ETIMEDOUT"}})})).toThrow("ETIMEDOUT");
    });
});

describe("版本比较", () => {
    it("语义化版本 2.0.0 规范第 11 条给的优先级顺序", () => {
        const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0"];
        for (let index = 1; index < ordered.length; index += 1) {
            expect(compareVersions(ordered[index - 1]!, ordered[index]!)).toBe(-1);
            expect(compareVersions(ordered[index]!, ordered[index - 1]!)).toBe(1);
        }
    });

    it("可以带 v；构建元数据不参与；旧应用的预发布式标签低于 0.12.1", () => {
        expect(compareVersions("v0.12.1", "0.12.1")).toBe(0);
        expect(compareVersions("1.0.0+a", "1.0.0+b")).toBe(0);
        expect(compareVersions("v0.9.2-canary.20260805.125926Z.39d220b7", "0.12.1")).toBe(-1);
        expect(() => compareVersions("latest", "1.0.0")).toThrow("不是语义化版本");
    });
});
