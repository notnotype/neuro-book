import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import writerProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/writer.profile";
import {createProfileHomeFacade, type ProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";
import {
    DEFAULT_PERSONA_PRESET,
    buildPersonaPrompt,
    initializePersonaHome,
    loadDefaultPersona,
    renderCustomBottomPrompt,
    renderCustomTopPrompt,
    renderPersonaResource,
    validatePersonaPreset,
} from "nbook/server/agent/profiles/prompt-customization";
import {DEFAULT_WRITING_REFERENCE_PRESET} from "nbook/server/agent/profiles/writer-writing-reference";
import {DEFAULT_WRITING_STYLE_PRESET} from "nbook/server/agent/profiles/writer-writing-style";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";
import {createTestRuntimeSession as testSession} from "nbook/server/agent/profiles/test/runtime-session";

describe("prompt customization", () => {
    let projectRoot: string;
    let home: ProfileHomeFacade;

    beforeAll(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "nbook-prompt-custom-"));
        home = createProfileHomeFacade(projectRoot, "writer");
    });

    afterAll(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("writer 出厂人设资产存在且包含核心段落", async () => {
        const persona = await loadDefaultPersona("writer");
        expect(persona).not.toBeNull();
        expect(persona).toContain("<role_definition>");
        expect(persona).toContain("<char_performance>");
        expect(persona).toContain("<avoid_words>");
    });

    it("initializePersonaHome 写入出厂 default.md，重复初始化不覆盖用户修改", async () => {
        await initializePersonaHome(home, "writer");
        expect(await home.exists(DEFAULT_PERSONA_PRESET)).toBe(true);
        await home.writeText(DEFAULT_PERSONA_PRESET, renderPersonaResource("用户改过", "用户自定义人设"), {mode: "overwrite"});
        await initializePersonaHome(home, "writer");
        const persona = await buildPersonaPrompt({profileKey: "writer", home});
        expect(persona).toBe("用户自定义人设");
    });

    it("buildPersonaPrompt 按预设读取，预设缺失时回退 default，再回退出厂资产", async () => {
        await home.writeText("prompts/dark.md", renderPersonaResource("暗黑风", "暗黑人设正文"), {mode: "overwrite"});
        expect(await buildPersonaPrompt({profileKey: "writer", preset: "prompts/dark.md", home})).toBe("暗黑人设正文");
        // 缺失预设 → 回退 home default.md（上一个用例改成了用户自定义文本）
        expect(await buildPersonaPrompt({profileKey: "writer", preset: "prompts/missing.md", home})).toBe("用户自定义人设");
        // 无 home → 回退出厂资产
        const factory = await buildPersonaPrompt({profileKey: "writer", preset: "prompts/missing.md"});
        expect(factory).toContain("<role_definition>");
    });

    it("validatePersonaPreset 检查预设存在性", async () => {
        expect(await validatePersonaPreset(DEFAULT_PERSONA_PRESET, home)).toBeNull();
        const issue = await validatePersonaPreset("prompts/nope.md", home);
        expect(issue?.path).toBe("personaPreset");
        expect(issue?.severity).toBe("error");
    });

    it("top/bottom 注入段为空时不渲染标签", () => {
        expect(renderCustomTopPrompt({customTopSystemPrompt: "  "})).toBe("");
        expect(renderCustomBottomPrompt({customBottomSystemPrompt: ""})).toBe("");
        expect(renderCustomTopPrompt({customTopSystemPrompt: "置顶规则"})).toContain("<custom_top_system_prompt>");
        expect(renderCustomBottomPrompt({customBottomSystemPrompt: "追加规则"})).toContain("<custom_bottom_system_prompt>");
    });

    it("writer prepare 渲染出厂人设与自定义注入段", async () => {
        const prepared = await writerProfile.prepare!({
            session: testSession({profileKey: "writer", workspaceRoot: "workspace"}),
            initial: {},
            settings: {
                customTopSystemPrompt: "这是置顶规则",
                customBottomSystemPrompt: "这是追加规则",
                personaPreset: DEFAULT_PERSONA_PRESET,
                writingStylePreset: DEFAULT_WRITING_STYLE_PRESET,
                writingReferencePreset: DEFAULT_WRITING_REFERENCE_PRESET,
                narrativePerson: "third" as const,
                paragraphRhythm: "段落节奏偏短段分行。",
                wordCountControl: "2000-2600 字",
                polishingWorkflow: "使用 stop-slop 做自查。",
                adultStylePrompt: "",
                fileChangeAwareness: "minimal" as const,
            },
            vars: createTestVariableAccessor(),
            catalog: {profiles: [], issues: []},
            skills: [],
        });
        const systemPrompt = prepared.systemPrompt ?? "";
        // 出厂人设（asset 回退链)
        expect(systemPrompt).toContain("<role_definition>");
        expect(systemPrompt).toContain("<char_performance>");
        // 自定义注入段位置：置顶在最前、追加在最后
        expect(systemPrompt).toContain("<custom_top_system_prompt>");
        expect(systemPrompt).toContain("<custom_bottom_system_prompt>");
        expect(systemPrompt.indexOf("<custom_top_system_prompt>")).toBeLessThan(systemPrompt.indexOf("<role_definition>"));
        expect(systemPrompt.indexOf("<custom_bottom_system_prompt>")).toBeGreaterThan(systemPrompt.indexOf("<output_protocol>"));
        // 合约段仍在
        expect(systemPrompt).toContain("<input_contract>");
        expect(systemPrompt).toContain("report_result");
    });
});
