import {mkdtemp, readFile, rm, writeFile, mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    assertRpRuntimeWritable,
    beginRpBootstrap,
    completeRpBootstrap,
    completeRpBootstrapStage,
    confirmRpIntakeFromPlayer,
    failRpBootstrap,
    readRpIntake,
    reviewRpIntake,
    RP_INTAKE_FIELD_KEYS,
    RP_INTAKE_RELATIVE_PATH,
    updateRpIntakeField,
} from "nbook/server/rp/intake-store";
import {RpIntakeConfirmRequestDtoSchema} from "nbook/shared/dto/rp-runtime.dto";

describe("RP adventure intake store", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-intake-"));
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("空项目从 empty 开始，字段更新推进阶段并保存版本快照", async () => {
        const empty = await readRpIntake(projectRoot);
        expect(empty.phase).toBe("empty");
        expect(empty.version).toBe(0);
        expect(empty.confirmedVersion).toBeNull();

        const source = await updateRpIntakeField(projectRoot, "source", {status: "confirmed", value: "guided"});
        expect(source.phase).toBe("source_selected");
        expect(source.version).toBe(1);

        const premise = await updateRpIntakeField(projectRoot, "premise", {status: "provisional", value: {title: "雾港"}});
        expect(premise.phase).toBe("premise_ready");
        expect(premise.version).toBe(2);
        await expect(readFile(join(projectRoot, ".nbook/rp/intake/versions/000002.json"), "utf-8")).resolves.toContain("雾港");
    });

    it("missing/conflict 阻止审阅，全部 resolved 后才进入 reviewing", async () => {
        await fillReadyDraft(projectRoot, {boundaries: "conflict"});
        await expect(reviewRpIntake(projectRoot)).rejects.toThrow("boundaries");

        await updateRpIntakeField(projectRoot, "boundaries", {status: "disabled", value: "玩家明确不设置额外禁区"});
        const reviewing = await reviewRpIntake(projectRoot);
        expect(reviewing.phase).toBe("reviewing");
    });

    it("只有当前 reviewing 版本能确认，暂定提案在最终确认时转为 confirmed", async () => {
        const draft = await fillReadyDraft(projectRoot);
        const reviewing = await reviewRpIntake(projectRoot);
        await expect(confirmRpIntakeFromPlayer(projectRoot, reviewing.version - 1)).rejects.toThrow("版本已变化");

        const confirmed = await confirmRpIntakeFromPlayer(projectRoot, draft.version);
        expect(confirmed.phase).toBe("confirmed");
        expect(confirmed.confirmedVersion).toBe(confirmed.version);
        expect(confirmed.fields.premise.status).toBe("confirmed");
    });

    it("状态页确认请求必须显式确认并绑定非负整数版本", () => {
        expect(RpIntakeConfirmRequestDtoSchema.safeParse({version: 8, confirmed: true}).success).toBe(true);
        expect(RpIntakeConfirmRequestDtoSchema.safeParse({version: 8, confirmed: false}).success).toBe(false);
        expect(RpIntakeConfirmRequestDtoSchema.safeParse({version: 8, confirmed: true, source: "agent"}).success).toBe(false);
    });

    it("草案确认后修改会递增版本并使旧确认失效", async () => {
        const draft = await fillReadyDraft(projectRoot);
        await reviewRpIntake(projectRoot);
        await confirmRpIntakeFromPlayer(projectRoot, draft.version);

        const changed = await updateRpIntakeField(projectRoot, "opening", {status: "confirmed", value: "改为暴雨夜开场"});
        expect(changed.version).toBe(draft.version + 1);
        expect(changed.confirmedVersion).toBeNull();
        expect(changed.phase).toBe("opening_ready");
        await expect(beginRpBootstrap(projectRoot)).rejects.toThrow("Bootstrap 被拒绝");
    });

    it("Bootstrap 门禁、原阶段失败重试与激活形成完整闭环", async () => {
        const draft = await fillReadyDraft(projectRoot);
        await expect(assertRpRuntimeWritable(projectRoot)).rejects.toThrow("正式运行写入被拒绝");
        await expect(beginRpBootstrap(projectRoot)).rejects.toThrow("Bootstrap 被拒绝");

        await reviewRpIntake(projectRoot);
        await confirmRpIntakeFromPlayer(projectRoot, draft.version);
        const running = await beginRpBootstrap(projectRoot);
        expect(running).toMatchObject({phase: "bootstrapping", bootstrap: {stage: "config", completedStages: []}});
        await expect(assertRpRuntimeWritable(projectRoot)).resolves.toMatchObject({phase: "bootstrapping"});

        const failed = await failRpBootstrap(projectRoot, "schema 无法加载");
        expect(failed.phase).toBe("bootstrapping");
        expect(failed.bootstrap).toMatchObject({status: "failed", stage: "config", error: {stage: "config"}});
        await expect(assertRpRuntimeWritable(projectRoot)).resolves.toMatchObject({phase: "bootstrapping", bootstrap: {status: "failed"}});

        for (const stage of ["config", "world", "map", "characters", "opening_event", "narrative"] as const) {
            await completeRpBootstrapStage(projectRoot, stage);
        }
        const active = await completeRpBootstrap(projectRoot);
        expect(active.phase).toBe("active");
        expect(active.bootstrap.status).toBe("complete");
        await expect(assertRpRuntimeWritable(projectRoot)).resolves.toMatchObject({phase: "active"});
    });

    it("损坏状态文件会明确报错，不静默重建", async () => {
        const statePath = join(projectRoot, RP_INTAKE_RELATIVE_PATH);
        await mkdir(join(projectRoot, ".nbook/rp/intake"), {recursive: true});
        await writeFile(statePath, "{broken", "utf-8");
        await expect(readRpIntake(projectRoot)).rejects.toThrow();
    });
});

async function fillReadyDraft(
    projectRoot: string,
    overrides: Partial<Record<typeof RP_INTAKE_FIELD_KEYS[number], "conflict">> = {},
) {
    let state = await readRpIntake(projectRoot);
    for (const key of RP_INTAKE_FIELD_KEYS) {
        const status = overrides[key] ?? (key === "premise" ? "provisional" : "confirmed");
        state = await updateRpIntakeField(projectRoot, key, {
            status,
            value: status === "conflict" ? [`${key} 方案 A`, `${key} 方案 B`] : `${key} 已设置`,
        });
    }
    return state;
}
