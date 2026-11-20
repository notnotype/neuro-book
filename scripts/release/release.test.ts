import {describe, expect, it} from "vitest";

import {githubRepository, parseCommand, pushArgv, rehearsalPassed, rehearsalsOn, ReleaseCommand, ReleaseCommandFailure, triggeredRun, type CommandResult, type WorkflowJob, type WorkflowRun} from "#scripts/release/release";

const HEAD = "a".repeat(40);
const RELEASE_COMMIT = "b".repeat(40);

function run(overrides: Partial<WorkflowRun>): WorkflowRun {
    return {databaseId: 1, headSha: HEAD, status: "completed", conclusion: "success", event: "workflow_dispatch", url: "https://example/runs/1", createdAt: "2026-11-20T10:00:00Z", ...overrides};
}

/**
 * 记录调用的替身：按命令前缀给结果，没写的命令成功、输出为空。git、gh 的真实行为由开发者第一次运行时核对（t24 的证据）。
 * 状态随调用变：prepare 之后 HEAD 变成发版提交。
 */
const GREEN: WorkflowJob[] = [{name: "门禁", conclusion: "success"}, {name: "发 npm", conclusion: "skipped"}];

/**
 * `runs` 是手动触发的运行列表（演练检查读它）；`dispatched` 在 `gh workflow run` 之后才出现，`pushRuns` 在推送之后才出现：
 * 和真实的一样，触发前列出来的运行不是这次触发的。
 */
function fake(options: {branch?: string; contains?: boolean; runs?: WorkflowRun[]; dispatched?: WorkflowRun[]; pushRuns?: WorkflowRun[]; push?: number; tagExists?: boolean; watch?: number; jobs?: WorkflowJob[]; intruder?: boolean; remoteTag?: string}) {
    const calls: string[][] = [];
    let head = HEAD;
    let dispatchedYet = false;
    let pushedYet = false;
    const respond = (argv: readonly string[]): CommandResult => {
        const line = argv.join(" ");
        if (line === "git remote get-url --push origin") return {code: 0, stdout: "git@github.com:notnotype/neuro-book.git\n"};
        if (line === "git rev-parse --abbrev-ref HEAD") return {code: 0, stdout: `${options.branch ?? "master"}\n`};
        if (line.startsWith("git merge-base --is-ancestor")) return {code: options.contains === false ? 1 : 0, stdout: ""};
        if (line === "git rev-parse HEAD") return {code: 0, stdout: `${head}\n`};
        if (line.startsWith("git rev-parse --verify")) return {code: options.tagExists === true ? 0 : 1, stdout: ""};
        if (line.startsWith("bun scripts/release/prepare.ts")) {
            head = RELEASE_COMMIT;
            return {code: 0, stdout: ""};
        }
        // 发版提交的父提交：别的会话插进一个提交时不是演练过的 HEAD。
        if (line === `git rev-parse ${RELEASE_COMMIT}^`) return {code: 0, stdout: options.intruder === true ? "c".repeat(40) : HEAD};
        if (line.startsWith("git log -1 --format=%s")) return {code: 0, stdout: "release: v0.15.0\n"};
        if (line.startsWith("git ls-remote")) return {code: 0, stdout: options.remoteTag === undefined ? "" : `${options.remoteTag}\trefs/tags/v0.15.0\n`};
        if (line.startsWith("git push --atomic")) {
            pushedYet = true;
            return {code: options.push ?? 0, stdout: ""};
        }
        if (line.startsWith("gh workflow run")) dispatchedYet = true;
        if (line.startsWith("gh run list") && line.includes("--event push")) return {code: 0, stdout: JSON.stringify(pushedYet ? options.pushRuns ?? [] : [])};
        if (line.startsWith("gh run list")) return {code: 0, stdout: JSON.stringify([...(dispatchedYet ? options.dispatched ?? [] : []), ...(options.runs ?? [])])};
        if (line.startsWith("gh run watch")) return {code: options.watch ?? 0, stdout: ""};
        if (line.startsWith("gh run view")) return {code: 0, stdout: JSON.stringify({jobs: options.jobs ?? GREEN})};
        return {code: 0, stdout: ""};
    };
    const command = new ReleaseCommand(async (argv) => {
        calls.push([...argv]);
        return respond(argv);
    }, async () => undefined, () => undefined);
    return {command, calls, lines: () => calls.map((call) => call.join(" "))};
}

const NOW = new Date().toISOString();

describe("命令行", () => {
    it("版本、阶段、跳过演练、rehearse 与 watch；别的写法是用法错误", () => {
        expect(parseCommand(["0.15.0"])).toEqual({kind: "release", version: "0.15.0", stage: undefined, rehearsal: true});
        expect(parseCommand(["0.15.0", "--stage", "preview", "--no-rehearsal"])).toEqual({kind: "release", version: "0.15.0", stage: "preview", rehearsal: false});
        expect(parseCommand(["rehearse"])).toEqual({kind: "rehearse"});
        expect(parseCommand(["watch", "0.15.0"])).toEqual({kind: "watch", version: "0.15.0"});
        for (const argv of [[], ["v0.15.0"], ["0.15.0-rc.1"], ["0.15.0", "--stage", "stable"], ["rehearse", "--stage", "canary"], ["watch"], ["0.15.0", "0.15.1"]]) {
            expect(() => parseCommand(argv), argv.join(" ")).toThrow(/用法/);
        }
    });
});

describe("仓库", () => {
    it("从 origin 的推送地址取 owner/name；不是 GitHub 的报错", () => {
        for (const url of ["git@github.com:notnotype/neuro-book.git", "ssh://git@github.com/notnotype/neuro-book", "https://github.com/notnotype/neuro-book.git\n", "https://github.com/notnotype/neuro-book/"]) {
            expect(githubRepository(url), url).toBe("notnotype/neuro-book");
        }
        expect(() => githubRepository("git@gitlab.com:a/b.git")).toThrow(/不是 GitHub/);
    });
});

describe("演练与触发的运行", () => {
    it("只看 HEAD 上已结束的手动演练，新的在前", () => {
        expect(rehearsalsOn([run({headSha: "c".repeat(40)}), run({event: "push"}), run({status: "in_progress", conclusion: null})], HEAD)).toEqual([]);
        expect(rehearsalsOn([run({databaseId: 7, createdAt: "2026-11-20T09:00:00Z"}), run({databaseId: 8, conclusion: "failure"})], HEAD).map((item) => item.databaseId)).toEqual([8, 7]);
    });

    it("演练通过：除 macOS 外都成功或跳过；macOS 失败不算不通过；没有作业（启动即失败）不算通过", () => {
        expect(rehearsalPassed(GREEN)).toBe(true);
        expect(rehearsalPassed([...GREEN, {name: "macOS / macOS 桌面包（Apple Silicon）", conclusion: "failure"}])).toBe(true);
        expect(rehearsalPassed([...GREEN, {name: "桌面包与 Windows 冒烟", conclusion: "failure"}])).toBe(false);
        expect(rehearsalPassed([...GREEN, {name: "CI / 治理、文档与受影响的包", conclusion: "cancelled"}])).toBe(false);
        expect(rehearsalPassed([])).toBe(false);
        expect(rehearsalPassed([{name: "macOS / 构建", conclusion: "success"}])).toBe(false);
    });

    it("触发的那一轮：同一提交、同一事件、触发前没有的里最新的一轮；不看时间", () => {
        const runs = [run({databaseId: 1, createdAt: "2026-11-20T09:00:00Z"}), run({databaseId: 2, createdAt: "2026-11-20T10:00:05Z"}), run({databaseId: 3, createdAt: "2026-11-20T10:00:09Z"}), run({databaseId: 4, headSha: "c".repeat(40), createdAt: "2026-11-20T10:01:00Z"})];
        expect(triggeredRun(runs, HEAD, "workflow_dispatch", new Set([3]))?.databaseId).toBe(2);
        expect(triggeredRun(runs, HEAD, "workflow_dispatch", new Set([1, 2, 3]))).toBeNull();
        expect(triggeredRun(runs, HEAD, "push", new Set())).toBeNull();
    });

    it("master 与标签在同一次原子推送里；master 的源是确切的提交号", () => {
        expect(pushArgv("0.15.0", RELEASE_COMMIT)).toEqual(["git", "push", "--atomic", "--no-follow-tags", "origin", `${RELEASE_COMMIT}:refs/heads/master`, "refs/tags/v0.15.0:refs/tags/v0.15.0"]);
    });
});

describe("发版", () => {
    it("演练通过：prepare、在发版提交上打标签、原子推送、盯标签触发的那一轮；运行失败时交回 false", async () => {
        const pushRuns = [run({databaseId: 9, headSha: RELEASE_COMMIT, event: "push", conclusion: null, status: "in_progress", createdAt: NOW})];
        const {command, lines} = fake({runs: [run({})], pushRuns, watch: 1});
        expect(await command.release({kind: "release", version: "0.15.0", stage: undefined, rehearsal: true})).toBe(false);
        const order = lines();
        const at = (prefix: string) => order.findIndex((line) => line.startsWith(prefix));
        expect(at("bun scripts/release/prepare.ts 0.15.0")).toBeGreaterThan(at("gh run view 1"));
        expect(order).toContain(`git tag v0.15.0 ${RELEASE_COMMIT}`);
        expect(at("git push --atomic")).toBeGreaterThan(at("git tag v0.15.0"));
        expect(order).toContain("gh run watch 9 --interval 30 --exit-status --repo notnotype/neuro-book");
        // gh 的每次调用都指明推送目标的仓库。
        expect(order.filter((line) => line.startsWith("gh ")).every((line) => line.endsWith("--repo notnotype/neuro-book"))).toBe(true);
    });

    it("没有演练、不在 master、HEAD 不含 origin/master、标签已在：什么都不写就停", async () => {
        const cases: Array<[Parameters<typeof fake>[0], RegExp]> = [
            [{runs: [run({conclusion: "failure"})], jobs: [{name: "桌面包与 Windows 冒烟", conclusion: "failure"}]}, /没有通过的演练/],
            [{runs: []}, /没有通过的演练/],
            [{branch: "feat/x"}, /发版要在 master 上/],
            [{contains: false}, /不包含 origin\/master/],
            [{runs: [run({})], tagExists: true}, /已经存在/],
        ];
        for (const [options, message] of cases) {
            const {command, lines} = fake(options);
            await expect(command.release({kind: "release", version: "0.15.0", stage: "canary", rehearsal: true})).rejects.toThrow(message);
            expect(lines().filter((line) => line.startsWith("bun scripts/release/prepare.ts") || line.startsWith("git push") || line.startsWith("git tag"))).toEqual([]);
        }
    });

    it("prepare 前后有别的提交插进来（发版提交的父提交不是演练过的 HEAD）：不打标签、不推送", async () => {
        const {command, lines} = fake({runs: [run({})], intruder: true});
        await expect(command.release({kind: "release", version: "0.15.0", stage: undefined, rehearsal: true})).rejects.toThrow(/有别的提交插了进来/);
        expect(lines().filter((line) => line.startsWith("git tag") || line.startsWith("git push"))).toEqual([]);
    });

    it("--no-rehearsal 不查演练；推送失败而远端没有标签时报错，给出原样重推的命令", async () => {
        const {command, lines} = fake({push: 1});
        const result = command.release({kind: "release", version: "0.15.0", stage: "preview", rehearsal: false});
        await expect(result).rejects.toThrow(ReleaseCommandFailure);
        await expect(result).rejects.toThrow(/远端没有 v0.15.0.*原样重推：git push --atomic/s);
        // 不查演练：没有读手动触发的运行。
        expect(lines().some((line) => line.startsWith("gh run list") && line.includes("workflow_dispatch"))).toBe(false);
        expect(lines()).toContain("bun scripts/release/prepare.ts 0.15.0 --stage preview");
    });

    it("推送报错但远端的标签已经指向发版提交：按推上去了处理，接着盯", async () => {
        const pushRuns = [run({databaseId: 9, headSha: RELEASE_COMMIT, event: "push", createdAt: NOW})];
        const {command, lines} = fake({push: 128, remoteTag: RELEASE_COMMIT, pushRuns});
        expect(await command.release({kind: "release", version: "0.15.0", stage: undefined, rehearsal: false})).toBe(true);
        expect(lines()).toContain("gh run watch 9 --interval 30 --exit-status --repo notnotype/neuro-book");
    });
});

describe("演练", () => {
    it("推 master、对 master 触发演练、盯这次触发的那一轮（同一提交上刚结束的旧一轮不算）", async () => {
        const dispatched = [run({databaseId: 5, status: "in_progress", conclusion: null, createdAt: NOW})];
        const {command, lines} = fake({runs: [run({databaseId: 4, createdAt: NOW})], dispatched});
        expect(await command.rehearse()).toBe(true);
        const order = lines();
        const pushed = order.indexOf(`git push --no-follow-tags origin ${HEAD}:refs/heads/master`);
        expect(pushed).toBeGreaterThanOrEqual(0);
        expect(pushed).toBeLessThan(order.indexOf("gh workflow run release.yml --ref master --repo notnotype/neuro-book"));
        expect(order).toContain("gh run watch 5 --interval 30 --exit-status --repo notnotype/neuro-book");
    });
});
