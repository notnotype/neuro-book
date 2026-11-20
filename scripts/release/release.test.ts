import {describe, expect, it} from "vitest";

import {parseCommand, pushArgv, ReleaseCommand, ReleaseCommandFailure, successfulRehearsal, triggeredRun, type CommandResult, type WorkflowRun} from "#scripts/release/release";

const HEAD = "a".repeat(40);
const RELEASE_COMMIT = "b".repeat(40);

function run(overrides: Partial<WorkflowRun>): WorkflowRun {
    return {databaseId: 1, headSha: HEAD, status: "completed", conclusion: "success", event: "workflow_dispatch", url: "https://example/runs/1", createdAt: "2026-11-20T10:00:00Z", ...overrides};
}

/**
 * 记录调用的替身：按命令前缀给结果，没写的命令成功、输出为空。git、gh 的真实行为由开发者第一次运行时核对（t24 的证据）。
 * 状态随调用变：prepare 之后 HEAD 变成发版提交。
 */
function fake(options: {branch?: string; contains?: boolean; runs?: WorkflowRun[]; pushRuns?: WorkflowRun[]; push?: number; tagExists?: boolean; watch?: number}) {
    const calls: string[][] = [];
    let head = HEAD;
    const respond = (argv: readonly string[]): CommandResult => {
        const line = argv.join(" ");
        if (line === "git rev-parse --abbrev-ref HEAD") return {code: 0, stdout: `${options.branch ?? "master"}\n`};
        if (line.startsWith("git merge-base --is-ancestor")) return {code: options.contains === false ? 1 : 0, stdout: ""};
        if (line === "git rev-parse HEAD") return {code: 0, stdout: `${head}\n`};
        if (line.startsWith("git rev-parse --verify")) return {code: options.tagExists === true ? 0 : 1, stdout: ""};
        if (line.startsWith("bun scripts/release/prepare.ts")) {
            head = RELEASE_COMMIT;
            return {code: 0, stdout: ""};
        }
        if (line.startsWith("git push --atomic")) return {code: options.push ?? 0, stdout: ""};
        if (line.startsWith("gh run list") && line.includes("--event push")) return {code: 0, stdout: JSON.stringify(options.pushRuns ?? [])};
        if (line.startsWith("gh run list")) return {code: 0, stdout: JSON.stringify(options.runs ?? [])};
        if (line.startsWith("gh run watch")) return {code: options.watch ?? 0, stdout: ""};
        if (line.startsWith("gh run view")) return {code: 0, stdout: JSON.stringify({jobs: [{name: "门禁", conclusion: "success"}]})};
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

describe("演练与触发的运行", () => {
    it("只认 HEAD 上已结束且成功的手动演练", () => {
        expect(successfulRehearsal([run({conclusion: "failure"}), run({headSha: "c".repeat(40)}), run({event: "push"}), run({status: "in_progress", conclusion: null})], HEAD)).toBeNull();
        expect(successfulRehearsal([run({databaseId: 7})], HEAD)?.databaseId).toBe(7);
    });

    it("推送触发的：同一提交、同一事件、推送之后建的里最新的一轮", () => {
        const after = new Date("2026-11-20T10:00:00Z");
        const runs = [run({databaseId: 1, createdAt: "2026-11-20T09:00:00Z"}), run({databaseId: 2, createdAt: "2026-11-20T10:00:05Z"}), run({databaseId: 3, createdAt: "2026-11-20T10:00:09Z"}), run({databaseId: 4, headSha: "c".repeat(40), createdAt: "2026-11-20T10:01:00Z"})];
        expect(triggeredRun(runs, HEAD, "workflow_dispatch", after)?.databaseId).toBe(3);
        expect(triggeredRun(runs, HEAD, "push", after)).toBeNull();
    });

    it("master 与标签在同一次原子推送里", () => {
        expect(pushArgv("0.15.0")).toEqual(["git", "push", "--atomic", "origin", "refs/heads/master:refs/heads/master", "refs/tags/v0.15.0:refs/tags/v0.15.0"]);
    });
});

describe("发版", () => {
    it("演练通过：prepare、在发版提交上打标签、原子推送、盯标签触发的那一轮；运行失败时交回 false", async () => {
        const pushRuns = [run({databaseId: 9, headSha: RELEASE_COMMIT, event: "push", conclusion: null, status: "in_progress", createdAt: NOW})];
        const {command, lines} = fake({runs: [run({})], pushRuns, watch: 1});
        expect(await command.release({kind: "release", version: "0.15.0", stage: undefined, rehearsal: true})).toBe(false);
        const order = lines();
        const at = (prefix: string) => order.findIndex((line) => line.startsWith(prefix));
        expect(at("bun scripts/release/prepare.ts 0.15.0")).toBeGreaterThan(at("gh run list"));
        expect(order).toContain(`git tag v0.15.0 ${RELEASE_COMMIT}`);
        expect(at("git push --atomic")).toBeGreaterThan(at("git tag v0.15.0"));
        expect(order).toContain("gh run watch 9 --interval 30 --exit-status");
    });

    it("没有演练、不在 master、HEAD 不含 origin/master、标签已在：什么都不写就停", async () => {
        const cases: Array<[Parameters<typeof fake>[0], RegExp]> = [
            [{runs: [run({conclusion: "failure"})]}, /没有成功的演练/],
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

    it("--no-rehearsal 不查演练；推送被拒时报错、写明远端没变与怎样重推", async () => {
        const {command, lines} = fake({push: 1});
        const result = command.release({kind: "release", version: "0.15.0", stage: "preview", rehearsal: false});
        await expect(result).rejects.toThrow(ReleaseCommandFailure);
        await expect(result).rejects.toThrow(/远端什么都没变/);
        expect(lines().some((line) => line.startsWith("gh run list"))).toBe(false);
        expect(lines()).toContain("bun scripts/release/prepare.ts 0.15.0 --stage preview");
    });
});

describe("演练", () => {
    it("推 master、对 master 触发演练、盯手动触发的那一轮", async () => {
        const runs = [run({databaseId: 5, status: "in_progress", conclusion: null, createdAt: NOW})];
        const {command, lines} = fake({runs});
        expect(await command.rehearse()).toBe(true);
        const order = lines();
        expect(order.indexOf("git push origin refs/heads/master:refs/heads/master")).toBeLessThan(order.indexOf("gh workflow run release.yml --ref master"));
        expect(order).toContain("gh run watch 5 --interval 30 --exit-status");
    });
});
