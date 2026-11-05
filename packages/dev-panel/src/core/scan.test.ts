import {afterEach, describe, expect, test} from "bun:test";
import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import {cleanupFixtures, createFixture, git} from "../../tests/git-fixture.js";
import {claimTask, claimWork, emptyRegistry} from "./registry.js";
import {listCheckouts, locateRepository} from "./repo.js";
import {findConflicts, nextTaskNumber, nextWorkNumber, partitionConflicts, scanNumbers, type NumberConflict} from "./scan.js";
import {readProjectStatus} from "./status.js";

afterEach(cleanupFixtures);

describe("编号扫描", () => {
    test("取主工作区（含未跟踪）、worktree 工作区、本地与远程跟踪分支、登记表里的最大值加一", async () => {
        const fixture = await createFixture("scan-next");
        await mkdir(join(fixture.main, ".agents/works/w00004-untracked/tasks"), {recursive: true});
        const worktree = await fixture.addWorktree("w00002-wt", "feat/w00002");
        await fixture.addWork("w00005-worktree-only", ["t07-x"], worktree);
        await git(fixture.main, "checkout", "--quiet", "-b", "side");
        await fixture.addWork("w00006-branch-only", ["t01-a"]);
        await fixture.commit("branch only work");
        await git(fixture.main, "checkout", "--quiet", "master");
        await git(fixture.main, "checkout", "--quiet", "-b", "remote-source");
        await fixture.addWork("w00008-remote-only", ["t01-a"]);
        await fixture.addWork("w00001-seed", ["t01-seed", "t12-remote"]);
        const remoteHead = await fixture.commit("remote only work");
        await git(fixture.main, "checkout", "--quiet", "master");
        await git(fixture.main, "update-ref", "refs/remotes/origin/feature", remoteHead);
        await git(fixture.main, "branch", "--quiet", "-D", "remote-source");

        const registry = emptyRegistry();
        expect(nextWorkNumber(await scanNumbers(fixture.main, await listCheckouts(fixture.main), registry))).toBe(9);
        expect(nextTaskNumber(await scanNumbers(fixture.main, await listCheckouts(fixture.main), registry), "w00001-seed")).toBe(13);
        expect(nextTaskNumber(await scanNumbers(fixture.main, await listCheckouts(fixture.main), registry), "w00005-worktree-only")).toBe(8);

        claimWork(registry, "w00011-claimed-but-missing", "2026-10-12T00:00:00.000Z");
        claimTask(registry, "w00001-seed", "t20-claimed", "2026-10-12T00:00:00.000Z");
        const scan = await scanNumbers(fixture.main, await listCheckouts(fixture.main), registry);
        expect(nextWorkNumber(scan)).toBe(12);
        expect(nextTaskNumber(scan, "w00001-seed")).toBe(21);
        expect((await findConflicts(fixture.main, scan)).registryOnly).toEqual(["w00001-seed/t20-claimed", "w00011-claimed-but-missing"]);
    });

    test("master 改名后分支上留下的旧副本不算 live；分出之后两边各自新建的同号算 live", async () => {
        const fixture = await createFixture("scan-conflicts");
        await fixture.addWork("w00003-ui", ["t05-preview-retirement"]);
        await fixture.commit("w00003");
        const worktree = await fixture.addWorktree("w00009-old", "feat/old");
        await git(fixture.main, "mv", ".agents/works/w00003-ui/tasks/t05-preview-retirement", ".agents/works/w00003-ui/tasks/t05-component-lab");
        await git(fixture.main, "commit", "--quiet", "-m", "rename t05");
        await fixture.addWork("w00007-desktop-fix", ["t01-a"], worktree);
        await fixture.commit("branch allocates w00007", worktree);
        await fixture.addWork("w00007-message-invoke", ["t01-b"]);
        await fixture.commit("master allocates w00007");

        const scan = await scanNumbers(fixture.main, await listCheckouts(fixture.main), emptyRegistry());
        const {conflicts} = await findConflicts(fixture.main, scan);
        const summary = Object.fromEntries(conflicts.map((conflict) => [conflict.label, [conflict.live, conflict.ids.map((entry) => [entry.id, entry.live])]]));
        expect(summary).toEqual({
            "w00007": [true, [["w00007-desktop-fix", true], ["w00007-message-invoke", true]]],
            "w00003-ui/t05": [false, [["t05-component-lab", true], ["t05-preview-retirement", false]]],
        });

        // 只在旧副本里的那组没有什么可动手的：不进收件箱、警告不提它，`conflicts` 里仍列着。
        const {status, warnings} = await readProjectStatus(await locateRepository(fixture.main));
        expect(status.inbox.flatMap((item) => (item.kind === "number_conflict" ? [item.label] : []))).toEqual(["w00007"]);
        expect(warnings.find((warning) => warning.code === "number_conflicts")?.details).toEqual({labels: ["w00007"]});
        expect(status.conflicts.map((conflict) => conflict.label).sort()).toEqual(["w00003-ui/t05", "w00007"]);
    });

    test("领号时的撞号只留涉及这次领的号：Work 按 wNNNNN，Task 按完整 workId 加 tNN，不拿裸的 t01 与别的 Work 比", () => {
        const group = (kind: "work" | "task", label: string, workId?: string): NumberConflict => ({kind, label, ...(workId === undefined ? {} : {workId}), ids: [], live: true});
        const conflicts = [group("work", "w00003"), group("work", "w00004"), group("task", "w00004-next/t01", "w00004-next"), group("task", "w00004-old/t01", "w00004-old"), group("task", "w00001-seed/t02", "w00001-seed")];
        const workNew = partitionConflicts(conflicts, [{kind: "work", number: "w00004"}, {kind: "task", workId: "w00004-next", number: "t01"}]);
        expect([workNew.related.map((conflict) => conflict.label), workNew.others]).toEqual([["w00004", "w00004-next/t01"], 3]);
        const taskNew = partitionConflicts(conflicts, [{kind: "task", workId: "w00001-seed", number: "t02"}]);
        expect([taskNew.related.map((conflict) => conflict.label), taskNew.others]).toEqual([["w00001-seed/t02"], 4]);
        expect(partitionConflicts(conflicts, [{kind: "task", workId: "w00009-none", number: "t01"}])).toEqual({related: [], others: 5});
    });
});
