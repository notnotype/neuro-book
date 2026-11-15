import {describe, expect, it} from "vitest";

import {parsePublishArguments, publishedState, releaseManifestProblems} from "#scripts/release/publish";
import {blockingStalePackages} from "#scripts/release/release-plan";

// 输出照 npm 10 的 `npm view <名>@<版本> version --json` 实际打印的形状（2026-10-24 对 registry.npmjs.org 取的）。
const NOT_FOUND = JSON.stringify({error: {code: "E404", summary: "Not Found - GET https://registry.npmjs.org/@notnotype%2fnb-ui - Not found"}});

describe("发布前查 registry", () => {
    it("版本在 registry 上算已发布；包或版本不存在（E404）算没发布", () => {
        expect(publishedState({code: 0, stdout: `[\n  "1.0.0"\n]\n`})).toBe("published");
        expect(publishedState({code: 0, stdout: `"1.0.0"\n`})).toBe("published");
        expect(publishedState({code: 1, stdout: NOT_FOUND})).toBe("unpublished");
    });

    it("其它失败不当成没发布：网络、权限、输出读不懂、成功却没有输出都抛出", () => {
        expect(() => publishedState({code: 1, stdout: JSON.stringify({error: {code: "ETIMEDOUT"}})})).toThrow("ETIMEDOUT");
        expect(() => publishedState({code: 1, stdout: JSON.stringify({error: {code: "E403"}})})).toThrow("E403");
        expect(() => publishedState({code: 1, stdout: "npm error something"})).toThrow("不是 JSON");
        expect(() => publishedState({code: 0, stdout: ""})).toThrow("分不清");
    });
});

describe("release:publish 的参数", () => {
    it("缺省只列出；--yes 才发布，--otp 与 --auth-type 原样转给 bun publish", () => {
        expect(parsePublishArguments([])).toEqual({mode: "local", yes: false, publishArgs: []});
        expect(parsePublishArguments(["--yes", "--auth-type", "web", "--otp", "123456"])).toEqual({mode: "local", yes: true, publishArgs: ["--auth-type=web", "--otp=123456"]});
    });

    it("流水线的两个入口：--plan 写计划；--ci 缺省只列出，带 --yes 才发布", () => {
        expect(parsePublishArguments(["--plan"])).toEqual({mode: "plan", yes: false, publishArgs: []});
        expect(parsePublishArguments(["--ci"])).toEqual({mode: "ci", yes: false, publishArgs: []});
        expect(parsePublishArguments(["--ci", "--yes"])).toEqual({mode: "ci", yes: true, publishArgs: []});
    });

    it("不认识的参数、缺值、--auth-type 取值不对时拒绝", () => {
        expect(() => parsePublishArguments(["--dry"])).toThrow("--dry");
        expect(() => parsePublishArguments(["--otp"])).toThrow("--otp");
        expect(() => parsePublishArguments(["--auth-type", "sms"])).toThrow("web 或 legacy");
    });

    it("--plan 与 --ci 不能同时给；两步验证的参数不用于流水线；--plan 不收 --yes", () => {
        expect(() => parsePublishArguments(["--plan", "--ci"])).toThrow("只能给一个");
        expect(() => parsePublishArguments(["--ci", "--otp", "123456"])).toThrow("只用于本机发布");
        expect(() => parsePublishArguments(["--plan", "--yes"])).toThrow("不收 --yes");
    });
});

describe("发布前核对冒烟留下的 tarball", () => {
    const manifest = {commit: "a".repeat(40), packages: [{name: "@notnotype/nb-ui", version: "0.1.0", tarball: "ui.tgz", sha256: "1"}, {name: "@notnotype/neuro-book", version: "0.11.0", tarball: "app.tgz", sha256: "2"}]};

    it("会发布的目录没改过、每个 tarball 的 SHA-256 对得上：通过", () => {
        expect(releaseManifestProblems(manifest, [], new Map([["ui.tgz", "1"], ["app.tgz", "2"]]))).toEqual([]);
    });

    it("会发布的目录改过、tarball 不见了、冒烟之后被改过：逐条报出，都提示重跑 release:smoke", () => {
        const problems = releaseManifestProblems(manifest, ["packages/nb-ui/src/a.ts"], new Map([["app.tgz", "3"]]));
        expect(problems).toHaveLength(3);
        expect(problems[0]).toContain("packages/nb-ui/src/a.ts");
        expect(problems[1]).toContain("ui.tgz 不在");
        expect(problems[2]).toContain("SHA-256 对不上");
        for (const problem of problems) expect(problem).toContain("release:smoke");
    });
});

describe("已发版本与验过的字节不同", () => {
    const dependenciesOf = new Map([["@x/story", ["@x/harness"]], ["@x/harness", ["@x/runtime"]], ["@x/app", []]]);

    it("要发的包直接或间接依赖它：拦下", () => {
        expect(blockingStalePackages(["@x/story"], ["@x/runtime", "@x/ui"], dependenciesOf)).toEqual(["@x/runtime"]);
    });

    it("要发的包不依赖它（应用把依赖打进了 bundle）：不拦，只提醒", () => {
        expect(blockingStalePackages(["@x/app"], ["@x/runtime", "@x/harness", "@x/story"], dependenciesOf)).toEqual([]);
    });
});
