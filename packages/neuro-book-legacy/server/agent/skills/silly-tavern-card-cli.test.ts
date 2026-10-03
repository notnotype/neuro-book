import path from "node:path";
import {cp, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {afterEach, describe, expect, it} from "vitest";
import {
    inspectCard,
    loadCardInput,
    runCli,
    slugify,
} from "nbook/assets/workspace/.nbook/agent/skills/novel-import-silly-tavern-card/scripts/silly-tavern-card";
import {SkillCatalog} from "nbook/server/agent/skills/skill-catalog";

describe("silly-tavern-card cli helpers", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        await Promise.all(tempRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("识别受控 raw 角色卡并统计 worldbook", async () => {
        const loaded = await loadCardInput(await createSyntheticCard(tempRoots));
        const inspection = inspectCard(loaded);

        expect(inspection.kind).toBe("character-card");
        expect(inspection.name).toBe("Synthetic ST Card");
        expect(inspection.counts.worldbookEntries).toBeGreaterThan(0);
    });

    it("识别 preset-like JSON，不当成角色卡", async () => {
        const loaded = await loadCardInput(await createSyntheticPreset(tempRoots));
        const inspection = inspectCard(loaded);

        expect(inspection.kind).toBe("preset");
        expect(inspection.warnings.join("\n")).toContain("preset");
    });

    it("统计 MVU/EJS 等动态 marker", async () => {
        const loaded = await loadCardInput(await createSyntheticCard(tempRoots));
        const inspection = inspectCard(loaded);

        expect(
            (inspection.markers.initVar ?? 0)
            + (inspection.markers.updateVariable ?? 0)
            + (inspection.markers.ejs ?? 0)
            + (inspection.markers.inject ?? 0)
            + (inspection.markers.generate ?? 0)
            + (inspection.markers.render ?? 0),
        ).toBeGreaterThan(0);
    });

    it("slug 过滤 Windows 非法路径字符并保留中文", () => {
        expect(slugify("命定之诗: v4.2.1 / test")).toBe("命定之诗-v4.2.1-test");
        expect(slugify("   ")).toBe("silly-tavern-card");
    });

    it("暴露为 v3 skill catalog 可发现的系统 skill", async () => {
        const emptyUserRoot = await mkdtemp(testHostPath("st-card-empty-user-skills-"));
        tempRoots.push(emptyUserRoot);
        const installRoot = await mkdtemp(testHostPath("st-card-install-skills-"));
        tempRoots.push(installRoot);
        await cp(path.resolve("assets/workspace/.nbook/agent/skills"), installRoot, {recursive: true});
        const catalog = new SkillCatalog(installRoot);
        const canonicalSkill = await catalog.get("novel-import-silly-tavern-card");

        expect(canonicalSkill?.source).toBe("install");
        expect(canonicalSkill?.description).toContain("SillyTavern");
        expect(canonicalSkill?.description).toContain("worldbooks");
    });

    it("inspect 只输出 overview，不生成解包文件", async () => {
        const workspace = await createProjectWorkspace(tempRoots);
        const input = await createSyntheticCard(tempRoots);

        const logs = await captureConsoleLog(() => runCli(["bun", "silly-tavern-card", "inspect", input]));

        expect(logs.join("\n")).toContain("Overview");
        await expect(stat(path.join(workspace, "reference"))).rejects.toThrow();
    });

    it("unpack 生成稳定解包目录和单个 generated.json", async () => {
        const workspace = await createProjectWorkspace(tempRoots);
        const input = await createSyntheticCard(tempRoots);

        await runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace]);
        const unpackDir = path.join(workspace, "reference", "silly-tavern", "Synthetic-ST-Card");
        const manifest = JSON.parse(await readFile(path.join(unpackDir, "generated.json"), "utf-8")) as {files: Record<string, unknown>};

        expect(await readFile(path.join(unpackDir, "raw", "card.json"), "utf-8")).toContain("chara_card_v3");
        expect(await readFile(path.join(unpackDir, "extensions", "tavern_helper.scripts.json"), "utf-8")).toContain("[");
        expect(await readFile(path.join(unpackDir, "extensions", "tavern_helper.variables.json"), "utf-8")).toContain("{");
        expect(await readFile(path.join(unpackDir, "extensions", "regex_scripts.json"), "utf-8")).toContain("[");
        await expect(stat(path.join(unpackDir, "card-body", "first-message.md"))).resolves.toBeDefined();
        const worldbookEntryFiles = await readdir(path.join(unpackDir, "worldbook", "entries"));
        expect(worldbookEntryFiles.length).toBeGreaterThan(0);
        const firstWorldbookEntryFile = worldbookEntryFiles[0];
        expect(firstWorldbookEntryFile).toBeDefined();
        if (!firstWorldbookEntryFile) {
            throw new Error("worldbook entry file missing");
        }
        expect(firstWorldbookEntryFile).toMatch(/^\d{6}-/);
        const entryOrders = worldbookEntryFiles.map((file) => Number(file.slice(0, 6)));
        expect(entryOrders).toEqual([...entryOrders].sort((left, right) => left - right));
        const firstWorldbookEntry = await readFile(path.join(unpackDir, "worldbook", "entries", firstWorldbookEntryFile), "utf-8");
        expect(firstWorldbookEntry).toContain("---\ntitle:");
        expect(firstWorldbookEntry).toContain("source: \"silly-tavern-worldbook\"");
        expect(firstWorldbookEntry).toContain("insertion_order:");
        expect(firstWorldbookEntry).toContain("extensions:");
        expect((await readdir(path.join(unpackDir, "extensions", "regex_scripts"))).length).toBeGreaterThan(0);
        expect((await readdir(path.join(unpackDir, "extensions", "tavern_helper", "scripts"))).length).toBeGreaterThan(0);
        expect(Object.keys(manifest.files).length).toBeGreaterThan(5);
        expect((await readdir(path.join(unpackDir, "raw"))).some((file) => file.endsWith(".generated.json"))).toBe(false);

        await expect(runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace])).rejects.toThrow("文件已存在");
        await runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace, "--force"]);

        const overviewPath = path.join(unpackDir, "overview.md");
        await writeFile(overviewPath, `${await readFile(overviewPath, "utf-8")}\n用户手改\n`, "utf-8");
        await expect(runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace, "--force"])).rejects.toThrow("拒绝覆盖");
    });

    it("import 从解包目录导入 worldbook，并拒绝 unknown 解包", async () => {
        const workspace = await createProjectWorkspace(tempRoots);
        const input = await createSyntheticCard(tempRoots);
        await runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace]);

        const unpackDir = "reference/silly-tavern/Synthetic-ST-Card";
        await runCli(["bun", "silly-tavern-card", "import", unpackDir, "--project", workspace, "--rp"]);
        const lorebookFiles = await listLorebookIndexFiles(workspace);
        expect(lorebookFiles.length).toBeGreaterThan(5);
        const firstLorebookFile = lorebookFiles[0];
        expect(firstLorebookFile).toBeDefined();
        if (!firstLorebookFile) {
            throw new Error("lorebook index file missing");
        }
        expect(firstLorebookFile).toContain(`${path.sep}lorebook${path.sep}`);
        expect(path.basename(path.dirname(firstLorebookFile))).toMatch(/^\d{6}-/);
        const firstLorebook = await readFile(firstLorebookFile, "utf-8");
        expect(firstLorebook).not.toContain("sillyTavernWorldbook:");
        expect(firstLorebook).toContain("insertion_order:");
        expect(firstLorebook).not.toContain("extensions:");
        expect(firstLorebook).not.toContain("> 来源：SillyTavern worldbook");
        expect(firstLorebook).not.toContain("> 分类原因：");
        expect(firstLorebook).not.toContain("（空）");
        const report = await readFile(path.join(workspace, unpackDir, "import-report.md"), "utf-8");
        expect(report).toContain("Import Mapping");
        expect(report).toContain("Dynamic Worldbook Archive");
        expect(report).toContain("Structural Markers");
        expect(report).toContain("Card Body Materials");
        expect(report).toContain("Classification Review Queue");
        expect(report).toContain("Recommended Next Steps");

        await expect(runCli(["bun", "silly-tavern-card", "import", unpackDir, "--project", workspace])).rejects.toThrow("文件已存在");

        const unknownJson = path.join(workspace, "unknown.json");
        await writeFile(unknownJson, "{\"hello\":\"world\"}\n", "utf-8");
        await runCli(["bun", "silly-tavern-card", "unpack", unknownJson, "--project", workspace, "--out", "reference/unknown"]);
        await expect(runCli(["bun", "silly-tavern-card", "import", "reference/unknown/unknown", "--project", workspace, "--force"])).rejects.toThrow("不是可识别");
    });

    it("按确定性分类映射稳定 worldbook，并归档动态条目和卡片主体素材", async () => {
        const workspace = await createProjectWorkspace(tempRoots);
        const input = await createSyntheticCard(tempRoots);
        await runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace]);

        const unpackDir = `reference/silly-tavern/${slugify("Synthetic ST Card")}`;
        const inspectJson = JSON.parse(await readFile(path.join(workspace, unpackDir, "inspect.json"), "utf-8")) as {
            mappingSummary: {dynamicArchived: number; structuralMarkers: number; cardBodyMaterials: number; needsReview: number; lorebookTargets: Record<string, number>};
        };
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/character"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/location"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/faction"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/species"]).toBe(2);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/rule"]).toBeUndefined();
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/world/rule"]).toBeGreaterThanOrEqual(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/item"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/event"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/system"]).toBe(1);
        expect(inspectJson.mappingSummary.lorebookTargets["lorebook/note"]).toBeGreaterThanOrEqual(3);
        expect(inspectJson.mappingSummary.dynamicArchived).toBe(1);
        expect(inspectJson.mappingSummary.structuralMarkers).toBe(1);
        expect(inspectJson.mappingSummary.cardBodyMaterials).toBe(6);
        expect(inspectJson.mappingSummary.needsReview).toBeGreaterThanOrEqual(3);

        const logs = await captureConsoleLog(() => runCli(["bun", "silly-tavern-card", "import", unpackDir, "--project", workspace, "--json"]));
        const importJson = JSON.parse(logs.join("\n")) as {
            mappingSummary: {dynamicArchived: number; structuralMarkers: number; cardBodyMaterials: number; needsReview: number; lorebookTargets: Record<string, number>};
        };
        expect(importJson.mappingSummary.dynamicArchived).toBe(1);
        expect(importJson.mappingSummary.structuralMarkers).toBe(1);
        expect(importJson.mappingSummary.cardBodyMaterials).toBe(6);
        expect(importJson.mappingSummary.needsReview).toBeGreaterThanOrEqual(3);
        expect(importJson.mappingSummary.lorebookTargets["lorebook/rule"]).toBeUndefined();

        await expect(stat(path.join(workspace, "lorebook", "character", slugify("000001-Synthetic-ST-Card-角色-艾丽丝"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "location", "帝国", "白曜城", "下城区", "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "faction", slugify("000003-Synthetic-ST-Card-势力-银月公会"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "species", slugify("000012-Synthetic-ST-Card-种族-精灵"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "species", slugify("000013-Synthetic-ST-Card-DLC-扩展-克系外神-种族-深潜者"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "rule"))).rejects.toThrow();
        await expect(stat(path.join(workspace, "lorebook", "world", "rule", slugify("000004-Synthetic-ST-Card-规则-魔法体系"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "item", slugify("000005-Synthetic-ST-Card-物品-世界之心"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "event", slugify("000006-Synthetic-ST-Card-事件-黄昏战争"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "system", slugify("000009-Synthetic-ST-Card-命定系统-核心数值"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "note", slugify("000008-Synthetic-ST-Card-神秘条目"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "note", slugify("000010-Synthetic-ST-Card-角色-地点-混合条目"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "note", slugify("000011-Synthetic-ST-Card-状态栏格式"), "index.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "system", slugify("000011-Synthetic-ST-Card-状态栏格式"), "index.md"))).rejects.toThrow();
        await expect(stat(path.join(workspace, "lorebook", "note", slugify("000007-Synthetic-ST-Card-InitVar-状态变量"), "index.md"))).rejects.toThrow();
        await expect(stat(path.join(workspace, unpackDir, "dynamic-worldbook", `${"000007"}-${slugify("InitVar 状态变量")}.md`))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "lorebook", "note", slugify("000014-Synthetic-ST-Card-➡️种族开始"), "index.md"))).rejects.toThrow();

        const importedCharacter = await readFile(path.join(workspace, "lorebook", "character", slugify("000001-Synthetic-ST-Card-角色-艾丽丝"), "index.md"), "utf-8");
        expect(importedCharacter).toContain("primaryCategory: \"character\"");
        expect(importedCharacter).toContain("classification:");
        expect(importedCharacter).not.toContain("sillyTavernWorldbook:");
        expect(importedCharacter).not.toContain("extensions:");
        expect(importedCharacter).not.toContain("> 来源：SillyTavern worldbook");
        expect(importedCharacter).not.toContain("> 分类原因：");
        expect(importedCharacter).not.toContain("（空）");
        const pendingNote = await readFile(path.join(workspace, "lorebook", "note", slugify("000008-Synthetic-ST-Card-神秘条目"), "index.md"), "utf-8");
        expect(pendingNote).toContain("status: \"pending\"");
        const mixedNote = await readFile(path.join(workspace, "lorebook", "note", slugify("000010-Synthetic-ST-Card-角色-地点-混合条目"), "index.md"), "utf-8");
        expect(mixedNote).toContain("status: \"pending\"");
        const statusUiNote = await readFile(path.join(workspace, "lorebook", "note", slugify("000011-Synthetic-ST-Card-状态栏格式"), "index.md"), "utf-8");
        expect(statusUiNote).toContain("status: \"pending\"");
        expect(statusUiNote).toContain("reviewFlags:");
        expect(statusUiNote).toContain("status-ui");
        const report = await readFile(path.join(workspace, unpackDir, "import-report.md"), "utf-8");
        expect(report).toContain("lorebook/character: 1");
        expect(report).toContain("lorebook/world/rule: 1");
        expect(report).toContain("Dynamic Worldbook Archive");
        expect(report).toContain("Structural Markers");
        expect(report).toContain("Card Body Materials");
        expect(report).toContain("Classification Review Queue");
        expect(report).toContain("Pending Lorebook Notes");
        expect(report).toContain("Recommended Next Steps");
        expect(report).toContain("InitVar 状态变量");
        expect(report).toContain("➡️种族开始");
        expect(report).toContain("角色-地点-混合条目");
        expect(report).toContain("状态栏格式");
        expect(report).toContain("subject knowledge generated: no");

        await expect(stat(path.join(workspace, unpackDir, "card-body", "first-message.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, unpackDir, "card-body", "alternate-greetings", "001.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, unpackDir, "card-body", "alternate-greetings", "002.md"))).resolves.toBeDefined();
    });

    it("--rp 只生成 simulation-migration 候选，不创建 simulation 运行态", async () => {
        const workspace = await createProjectWorkspace(tempRoots);
        const input = await createSyntheticCard(tempRoots);
        await runCli(["bun", "silly-tavern-card", "unpack", input, "--project", workspace]);

        const unpackDir = `reference/silly-tavern/${slugify("Synthetic ST Card")}`;
        await runCli(["bun", "silly-tavern-card", "import", unpackDir, "--project", workspace, "--rp"]);

        const migrationDir = path.join(workspace, unpackDir, "simulation-migration");
        await expect(stat(path.join(migrationDir, "README.md"))).resolves.toBeDefined();
        await expect(stat(path.join(migrationDir, "simulator-candidates.md"))).resolves.toBeDefined();
        await expect(stat(path.join(migrationDir, "writer-candidates.md"))).resolves.toBeDefined();
        await expect(stat(path.join(migrationDir, "subject-candidates.md"))).resolves.toBeDefined();
        await expect(stat(path.join(migrationDir, "entity-candidates.md"))).resolves.toBeDefined();
        await expect(stat(path.join(migrationDir, "unsupported-runtime.md"))).resolves.toBeDefined();
        await expect(stat(path.join(workspace, "simulation", "subjects"))).rejects.toThrow();
        await expect(stat(path.join(workspace, "simulation", "entities"))).rejects.toThrow();
        await expect(stat(path.join(workspace, "simulation", "runs"))).rejects.toThrow();

        const unsupported = await readFile(path.join(migrationDir, "unsupported-runtime.md"), "utf-8");
        expect(unsupported).toContain("Unsupported Runtime");
        expect(unsupported).toContain("InitVar 状态变量");
    });

    it("拒绝非 Project Workspace", async () => {
        const notWorkspace = await mkdtemp(testHostPath("st-card-not-workspace-"));
        tempRoots.push(notWorkspace);
        const input = await createSyntheticCard(tempRoots);

        await expect(runCli(["bun", "silly-tavern-card", "unpack", input, "--project", notWorkspace])).rejects.toThrow("project.yaml");
    });
});

async function createProjectWorkspace(tempRoots: string[]): Promise<string> {
    const workspace = await mkdtemp(testHostPath("st-card-workspace-"));
    tempRoots.push(workspace);
    await writeFile(path.join(workspace, "project.yaml"), "kind: novel\ntitle: Test\n", "utf-8");
    return workspace;
}

async function listLorebookIndexFiles(workspace: string): Promise<string[]> {
    const roots = ["character", "location", "faction", "world/rule", "item", "event", "species", "system", "note"];
    const files: string[] = [];
    for (const root of roots) {
        const rootPath = path.join(workspace, "lorebook", root);
        files.push(...await listIndexFiles(rootPath));
    }
    return files.sort();
}

async function listIndexFiles(rootPath: string): Promise<string[]> {
    let entries: string[] = [];
    try {
        entries = await readdir(rootPath);
    } catch {
        return [];
    }
    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = path.join(rootPath, entry);
        const stats = await stat(fullPath);
        if (!stats.isDirectory()) {
            continue;
        }
        try {
            await stat(path.join(fullPath, "index.md"));
            files.push(path.join(fullPath, "index.md"));
        } catch {
            files.push(...await listIndexFiles(fullPath));
        }
    }
    return files;
}

async function createSyntheticCard(tempRoots: string[]): Promise<string> {
    const root = await mkdtemp(testHostPath("st-card-synthetic-"));
    tempRoots.push(root);
    const file = path.join(root, "synthetic.raw.json");
    await writeFile(file, JSON.stringify({
        spec: "chara_card_v3",
        spec_version: "3.0",
        data: {
            name: "Synthetic ST Card",
            description: "这是合成卡描述。",
            scenario: "合成场景发生在白塔。",
            first_mes: "欢迎来到白塔。",
            alternate_greetings: [
                "备用开场一。",
                "备用开场二。",
            ],
            mes_example: "<START>\n艾丽丝：请保持冷静。",
            character_book: {
                entries: [
                    syntheticEntry(1, "角色-艾丽丝", "背景故事: 艾丽丝是白塔守望者。\n性格: 冷静。"),
                    syntheticEntry(2, "帝国-城镇-白曜城-下城区", "下城区位于白曜城边缘，是古代观测站旧址。"),
                    syntheticEntry(3, "势力-银月公会", "银月公会成员负责守护商路。"),
                    syntheticEntry(4, "规则-魔法体系", "施法必须消耗以太，并接受判定。"),
                    syntheticEntry(5, "物品-世界之心", "持有世界之心者可以感到异常力量，用途未知。"),
                    syntheticEntry(6, "事件-黄昏战争", "黄昏战争发生于旧历末年，是主线导火索。"),
                    syntheticEntry(7, "InitVar 状态变量", "[InitVar]\n<UpdateVariable name=\"favor\" />"),
                    syntheticEntry(8, "神秘条目", "一段没有明显结构的描述。"),
                    syntheticEntry(9, "命定系统-核心数值", "核心数值包含经验值、复活机制、战斗协议和生产制作。"),
                    syntheticEntry(10, "角色-地点-混合条目", "背景故事: 艾丽丝来自白塔。\n白塔位于北境边缘。"),
                    syntheticEntry(11, "状态栏格式", "状态栏必须输出好感度、背包栏和日程面板。"),
                    syntheticEntry(12, "种族-精灵", "精灵寿命漫长，族群重视森林契约。"),
                    syntheticEntry(13, "DLC-扩展-克系外神-种族-深潜者", "深潜者是沿海传说中的智慧生物。"),
                    syntheticEntry(14, "➡️种族开始", ""),
                ],
            },
            extensions: {
                regex_scripts: [{script_name: "Synthetic Regex", find_regex: "foo", replace_string: "bar"}],
                tavern_helper: {
                    scripts: [{id: "synthetic-script", name: "Synthetic Script", content: "console.log('synthetic')"}],
                    variables: {favor: 0},
                },
            },
        },
    }, null, 2) + "\n", "utf-8");
    return file;
}

async function createSyntheticPreset(tempRoots: string[]): Promise<string> {
    const root = await mkdtemp(testHostPath("st-card-preset-"));
    tempRoots.push(root);
    const file = path.join(root, "synthetic-preset.json");
    await writeFile(file, `${JSON.stringify({
        prompts: [{identifier: "main", content: "Synthetic preset"}],
        prompt_order: [{order: ["main"]}],
    }, null, 2)}\n`, "utf-8");
    return file;
}

function syntheticEntry(insertionOrder: number, comment: string, content: string): Record<string, unknown> {
    return {
        uid: insertionOrder,
        comment,
        content,
        disable: false,
        constant: false,
        insertion_order: insertionOrder,
        keys: [],
        secondary_keys: [],
        extensions: {position: 0},
    };
}

async function captureConsoleLog(callback: () => Promise<void>): Promise<string[]> {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...items: unknown[]) => {
        logs.push(items.map(String).join(" "));
    };
    try {
        await callback();
        return logs;
    } finally {
        console.log = original;
    }
}

