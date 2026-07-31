import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import writerProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/writer.profile";
import inlineEditorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/inline.editor.profile";
import {DEFAULT_WRITING_REFERENCE_PRESET} from "nbook/server/agent/profiles/writer-writing-reference";
import {DEFAULT_WRITING_STYLE_PRESET} from "nbook/server/agent/profiles/writer-writing-style";
import {messageText} from "nbook/server/agent/messages/message-utils";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";
import {createTestRuntimeSession as testSession} from "nbook/server/agent/profiles/test/runtime-session";

describe("writer profile contract", () => {
    it("暴露正文写作 profile 基础合同", () => {
        expect(writerProfile.manifest.key).toBe("writer");
        expect(writerProfile.manifest.name).toBe("正文写作");
        expect(writerProfile.initialSchema).toBeDefined();
        expect(writerProfile.payloadSchema).toBeDefined();
        expect(writerProfile.outputSchema).toBeDefined();
    });

    it("拥有文件工具、readonly World Engine 和 Plot 只读工具，但不持有 Plot 写工具", () => {
        const toolKeys = writerProfile.rootToolKeys;

        expect(toolKeys).toContain("read");
        expect(toolKeys).toContain("write");
        expect(toolKeys).toContain("edit");
        expect(toolKeys).toContain("bash");
        expect(toolKeys).toContain("execute_world");
        expect(toolKeys).toContain("report_result");
        // autonomous 模式:writer 自主读 Plot（plotReadBindings bundle）。
        expect(toolKeys).toContain("get_chapter_writer_brief");
        expect(toolKeys).toContain("get_story_chapter");
        expect(toolKeys).toContain("get_story_scene_context");
        expect(toolKeys).toContain("get_scene_world_context");
        expect(toolKeys).toContain("get_story_tree");
        expect(toolKeys).toContain("get_story_thread");
        // 只读:不持有 Plot save_* 写工具与文件 apply_patch。
        expect(toolKeys).not.toContain("apply_patch");
        expect(toolKeys).not.toContain("save_story_scene");
        expect(toolKeys).not.toContain("save_story_thread");
        expect(toolKeys).not.toContain("save_story_chapter");
        expect(toolKeys).not.toContain("save_story_act");
        expect(toolKeys).not.toContain("save_story_promise");
        expect(toolKeys).not.toContain("save_promise_beat");
        expect(toolKeys).not.toContain("save_story_decision");
        expect(toolKeys).not.toContain("write_world_slice");
        expect(toolKeys).not.toContain("delete_world_slice");
    });

    it("builtin profile 不把 CurrentUserInput 复制进 AppendingSet", async () => {
        const prepared = await inlineEditorProfile.prepare!({
            session: testSession({
                profileKey: "inline.editor",
                workspaceRoot: "workspace",
                projectPath: "workspace/current-user-input-test",
            }),
            initial: {},
            invocation: {
                message: "只应由 Harness 作为 CurrentUserInput 注入",
                caller: {kind: "user"},
            },
            vars: createTestVariableAccessor(),
            catalog: {profiles: [], issues: []},
            skills: [],
            settings: {},
        });

        expect((prepared.appendingMessages ?? []).map(messageText)).not.toContain("只应由 Harness 作为 CurrentUserInput 注入");
        expect(prepared.turnContexts ?? []).toEqual([]);
    });

    it("提示词声明 autonomous 自主模式，并渲染 input.chapterId 自取 brief 提示", async () => {
        const projectSlug = `writer-project-${randomUUID()}`;
        const projectRoot = resolve("workspace", projectSlug);
        await mkdir(projectRoot, {recursive: true});
        await writeFile(join(projectRoot, "project.yaml"), "kind: novel\ntitle: Writer Contract\nsummary: \"\"\n", "utf8");
        try {
            const prepared = await writerProfile.prepare!({
                session: testSession({
                    profileKey: "writer",
                    workspaceRoot: "workspace",
                    projectPath: `workspace/${projectSlug}`,
                }),
                initial: {},
                settings: defaultWriterSettings(),
                invocation: {
                    message: "请根据本章 brief 写正文。",
                    payload: {
                        path: "manuscript/001-chapter/index.md",
                        chapterId: "42",
                        context: {
                            lorebookEntries: ["lorebook/character/hero/"],
                            readablePaths: ["manuscript/000-prologue/index.md"],
                        },
                    },
                    caller: {kind: "user"},
                },
                vars: createTestVariableAccessor(),
                catalog: {profiles: [], issues: []},
                skills: [],
            });
            const systemPrompt = prepared.systemPrompt ?? "";
            const historyContext = (prepared.historyInitMessages ?? []).map(messageText).join("\n");
            const writerInputContext = historyContext.slice(historyContext.indexOf("<writer_input_context>"));

            // autonomous 契约:自主查证,不再宣称"不持有 Plot tools"。
            expect(systemPrompt).toContain("autonomous");
            expect(systemPrompt).toContain("get_chapter_writer_brief");
            expect(systemPrompt).not.toContain("你不持有 Plot tools");
            expect(historyContext).toContain("<writer_input_context>");
            expect(historyContext).toContain("path: manuscript/001-chapter/index.md");
            expect(historyContext).toContain("chapterPath: manuscript/001-chapter/");
            // input.chapterId 渲染为自取 brief 提示。
            expect(writerInputContext).toContain("42");
            expect(writerInputContext).toContain("get_chapter_writer_brief");
            expect(writerInputContext).toContain("lorebook/character/hero/");
            expect(writerInputContext).toContain("manuscript/000-prologue/index.md");
            // CurrentUserInput 由 Harness 独立追加；Profile 不得再把 invocation.message 复制进 AppendingSet。
            expect((prepared.appendingMessages ?? []).map(messageText)).not.toContain("请根据本章 brief 写正文。");
            expect(prepared.turnContexts).toEqual([{
                kind: "file-change-notice",
                mode: "minimal",
                appendingIndex: 0,
            }]);
        } finally {
            await rm(projectRoot, {recursive: true, force: true});
        }
    });
});

/**
 * 创建 writer profile 测试使用的默认 settings。
 */
function defaultWriterSettings() {
    return {
        promptEntries: [],
        personaPreset: "prompts/default.md",
        writingStylePreset: DEFAULT_WRITING_STYLE_PRESET,
        writingReferencePreset: DEFAULT_WRITING_REFERENCE_PRESET,
        narrativePerson: "third" as const,
        paragraphRhythm: "段落节奏偏短段分行。",
        wordCountControl: "2000-2600 字",
        polishingWorkflow: "使用 stop-slop 做自查。",
        adultStylePrompt: "",
        fileChangeAwareness: "minimal" as const,
    };
}
