import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {ensureRpCharacter, writeMood, writeSoul} from "nbook/server/rp/character-store";
import {activateRpAdventure, checkpointRpBootstrap, initializeRpBootstrapConfig, RP_OPENING_PROSE_PATH, RP_OPENING_STAGING_PATH} from "nbook/server/rp/bootstrap-store";
import {
    beginRpBootstrap,
    confirmRpIntakeFromPlayer,
    readRpIntake,
    reviewRpIntake,
    RP_INTAKE_FIELD_KEYS,
    updateRpIntakeField,
} from "nbook/server/rp/intake-store";
import {listTickProse} from "nbook/server/rp/prose-store";
import {prepareBootstrapArtifacts} from "nbook/server/rp/test-fixtures";

describe("RP bootstrap orchestrator", {timeout: 30_000}, () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-bootstrap-"));
        for (const key of RP_INTAKE_FIELD_KEYS) {
            await updateRpIntakeField(projectRoot, key, {status: "confirmed", value: `${key} ready`});
        }
        const reviewing = await reviewRpIntake(projectRoot);
        await confirmRpIntakeFromPlayer(projectRoot, reviewing.version);
        await beginRpBootstrap(projectRoot);
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("配置 loader 失败会自动记录真实阶段并停止 Bootstrap", async () => {
        await mkdir(join(projectRoot, "rp/manual"), {recursive: true});
        await mkdir(join(projectRoot, "rp/lorebook"), {recursive: true});
        await mkdir(join(projectRoot, "rp/world-engine/schema"), {recursive: true});
        await writeFile(join(projectRoot, "rp/manual/README.md"), "# 测试\n", "utf-8");
        await writeFile(join(projectRoot, "rp/world-engine/schema/index.ts"), "import {z} from 'zod'; export const Character = z.object({name: z.string()});\n", "utf-8");
        await writeFile(join(projectRoot, "rp/world-engine/calendar.ts"), "export default {type: 'gregorian', eraBefore: '前', eraAfter: '后', format: '{year}'};\n", "utf-8");

        await expect(checkpointRpBootstrap(projectRoot, "config")).rejects.toThrow("schema 必须导出");
        const state = await readRpIntake(projectRoot);
        expect(state).toMatchObject({phase: "bootstrapping", bootstrap: {status: "failed", stage: "config", error: {stage: "config"}}});

        await initializeRpBootstrapConfig(projectRoot, {calendarPreset: "gregorian"});
        const retried = await checkpointRpBootstrap(projectRoot, "config");
        expect(retried).toMatchObject({phase: "bootstrapping", bootstrap: {status: "running", stage: "world", completedStages: ["config"]}});
        await expect(readFile(join(projectRoot, "rp/world-engine/calendar.ts"), "utf-8")).resolves.toContain('type: "gregorian"');
    });

    it("标准配置初始化生成真实 Zod Schema，并支持受限 Simple 历法预设", async () => {
        await initializeRpBootstrapConfig(projectRoot, {calendarPreset: "simple", eraBefore: "旧校历", eraAfter: "新校历"});
        const schema = await readFile(join(projectRoot, "rp/world-engine/schema/index.ts"), "utf-8");
        const calendar = await readFile(join(projectRoot, "rp/world-engine/calendar.ts"), "utf-8");
        expect(schema).toContain("character: z.object");
        expect(schema).toContain("位置: Ref(\"location\")");
        expect(calendar).toContain('type: "simple"');
        expect(calendar).toContain('{name: "minute", parent: "second", ratio: 60}');
        expect(calendar).toContain('eraAfter: "新校历"');
    });

    it("普通 shape 对象不能伪装 Zod subject type", async () => {
        await mkdir(join(projectRoot, "rp/manual"), {recursive: true});
        await mkdir(join(projectRoot, "rp/lorebook"), {recursive: true});
        await mkdir(join(projectRoot, "rp/world-engine/schema"), {recursive: true});
        await writeFile(join(projectRoot, "rp/manual/README.md"), "# 测试\n", "utf-8");
        await writeFile(join(projectRoot, "rp/world-engine/schema/index.ts"), [
            "export default {subjectTypes: {",
            "    world: {shape: {}},",
            "    character: {shape: {}},",
            "    location: {shape: {}},",
            "}};",
        ].join("\n"), "utf-8");
        await writeFile(join(projectRoot, "rp/world-engine/calendar.ts"), "export default {type: 'gregorian', eraBefore: '前', eraAfter: '后', format: '{year}'};\n", "utf-8");

        await expect(checkpointRpBootstrap(projectRoot, "config")).rejects.toThrow("必须使用 z.object");
    });

    it("未激活时隐藏 staging，最终验收后原子发布 Tick 000000", async () => {
        await prepareBootstrapArtifacts(projectRoot);
        expect(await readRpIntake(projectRoot)).toMatchObject({phase: "bootstrapping", bootstrap: {stage: "ready_to_activate"}});
        await expect(readFile(join(projectRoot, RP_OPENING_STAGING_PATH), "utf-8")).resolves.toContain("测试开场正文");
        await expect(listTickProse(projectRoot)).resolves.toEqual([]);

        const active = await activateRpAdventure(projectRoot);
        expect(active).toMatchObject({phase: "active", bootstrap: {status: "complete", stage: "complete"}});
        await expect(readFile(join(projectRoot, RP_OPENING_PROSE_PATH), "utf-8")).resolves.toContain("测试开场正文");
        await expect(readFile(join(projectRoot, RP_OPENING_STAGING_PATH), "utf-8")).rejects.toMatchObject({code: "ENOENT"});
        expect((await listTickProse(projectRoot)).map((item) => item.dir)).toEqual(["000000-initial-state"]);
    });

    it("仅有化身且没有具名 NPC 时也能通过 characters 验收", async () => {
        await prepareBootstrapArtifacts(projectRoot, "map");
        await ensureRpCharacter(projectRoot, "player", {name: "玩家", kind: "player"});
        await writeSoul(projectRoot, "player", "# 玩家\n\n完整的化身人设。\n");
        await writeMood(projectRoot, "player", "# 心境\n\n准备踏入未知旅程。\n");

        await expect(checkpointRpBootstrap(projectRoot, "characters")).resolves.toMatchObject({
            phase: "bootstrapping",
            bootstrap: {stage: "opening_event", completedStages: ["config", "world", "map", "characters"]},
        });
    });
});
