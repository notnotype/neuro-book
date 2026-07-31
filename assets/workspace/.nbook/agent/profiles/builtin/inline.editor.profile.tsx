/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {InlineEditorInitialSchema, InlineEditorOutputSchema, InlineEditorPayloadSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {AppendingSet, If, Message, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderPromptEntries} from "nbook/server/agent/profiles/prompt-customization";

export const profileManifest = {
    key: "inline.editor",
    name: "Inline AI 编辑",
    description: "从编辑器选区触发的短程正文编辑 agent：根据 hidden payload 读取目标文件并使用 edit/write 直接修改。",
} as const;

export const InitialSchema = InlineEditorInitialSchema;
export const PayloadSchema = InlineEditorPayloadSchema;
export const OutputSchema = InlineEditorOutputSchema;
export type Initial = Static<typeof InitialSchema>;
export type Payload = Static<typeof PayloadSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    payloadSchema: PayloadSchema,
    outputSchema: OutputSchema,
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("inline.editor"),
    tools: toolset(
        builtin.file.read,
        builtin.file.edit,
        builtin.file.write,
        builtin.result.main(),
    ),
    async context(ctx) {
        const inputContext = renderInlineEditContext(ctx);
        const persona = await buildPersonaPrompt({profileKey: "inline.editor", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderPromptEntries(ctx.settings, "before"),
                        persona,
                        profileText`
                        <inline_editor_contract>
                            - 本轮任务来自 hidden payload。可见 message 只是用户界面回执，不能从可见消息反解析选区正文。
                            - Project-bound File Scope 是当前 Project Workspace，文件工具直接使用 manuscript/...、lorebook/...。
                            - 所有文件操作路径必须使用 <inline_edit target> 与 <ref path> 的完整原值，不要自行添加 Project slug。
                            - 不要尝试截断或猜测路径；payload 已确保路径可直接传给 read/edit/write 工具。
                            - 修改前必须先 read target 文件确认上下文；引用路径不同于 target 时，也必须先 read 引用文件。
                            - 优先使用 edit 做局部修改。只有确实需要整体重写或创建文件时才使用 write。
                            - scope="selection" 时，优先只修改 refs 指向的范围及必要衔接文本。
                            - scope="auto" 时，根据 instruction 判断最小必要修改范围。
                            - L12 | 这类行号只是定位标记，不是正文，绝对不能写回文件。
                            - task=chat 时，根据用户要求与上下文自然处理；如果用户要求修改正文，可以直接 edit/write。
                            - task=continue_after 时，在最后一个引用范围之后续写。
                            - task=bridge 时，补出承上启下的过渡；如果有两个引用，优先连接 r1 到 r2。
                            - 不要输出完整改后正文到聊天里；完成后调用 report_result，用 result 简短说明改了哪里。
                        </inline_editor_contract>

                        ${inputContext}
                        `,
                        renderPromptEntries(ctx.settings, "after"),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <AppendingSet>
                    <If condition={!ctx.invocation?.message}>
                        <Message>本轮没有收到用户可见消息；请根据 hidden payload 执行，若 payload 也缺失则 report_result 说明无法编辑。</Message>
                    </If>
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

/**
 * 渲染当前 Project 上下文，明确告知 Agent projectSlug 和 projectPath。
 */
function renderProjectContext(ctx: ProfilePrepareContext<Initial, Payload>): string {
    const projectPath = ctx.session.projectPath;
    if (!projectPath) {
        return "projectPath: (none - user-assets mode)";
    }
    // projectPath固定为公开Project Path：workspace/project-slug。
    const projectSlug = projectPath.replace(/^workspace\//u, "");
    return [
        `projectSlug: ${projectSlug}`,
        `projectPath: ${projectPath.startsWith("workspace/") ? projectPath : `workspace/${projectPath}`}`,
    ].join("\n");
}

/**
 * 渲染 inline editor payload。
 */
function renderInlineEditContext(ctx: ProfilePrepareContext<Initial, Payload>): string {
    const payload = ctx.invocation?.payload;
    if (!payload) {
        return [
            "<inline_editor_input>",
            `File Scope: ${ctx.session.projectPath ?? ctx.session.workspaceRoot}`,
            renderProjectContext(ctx),
            "<missing_payload>未收到 inline editor payload。不要修改文件，调用 report_result 说明缺少编辑输入。</missing_payload>",
            "</inline_editor_input>",
        ].join("\n");
    }

    return [
        "<inline_editor_input>",
        `File Scope: ${ctx.session.projectPath ?? ctx.session.workspaceRoot}`,
        renderProjectContext(ctx),
        renderInlineEditXml(payload),
        "</inline_editor_input>",
    ].join("\n");
}

function renderInlineEditXml(payload: Payload): string {
    const refs = payload.references.length > 0
        ? [
            "  <refs>",
            ...payload.references.map((reference, index) => renderReference(reference, index)),
            "  </refs>",
        ]
        : [];
    return [
        `<inline_edit v="1" task="${escapeXml(payload.task)}" op="${taskOp(payload.task)}" target="${escapeXml(payload.targetPath)}" scope="${payload.references.length > 0 ? "selection" : "auto"}">`,
        `  <instruction>${escapeXml(payload.instruction || defaultInstruction(payload.task))}</instruction>`,
        ...refs,
        "</inline_edit>",
    ].join("\n");
}

function renderReference(reference: Payload["references"][number], index: number): string {
    const lines = reference.range
        ? `${String(reference.range.startLine)}-${String(reference.range.endLine)}`
        : "";
    return [
        `    <ref id="r${String(index + 1)}" source="${escapeXml(reference.ref)}" path="${escapeXml(reference.path)}" lines="${escapeXml(lines)}" match="${escapeXml(reference.match)}"><![CDATA[`,
        formatReferenceText(reference),
        "]]></ref>",
    ].join("\n");
}

function formatReferenceText(reference: Payload["references"][number]): string {
    const text = escapeCdata(reference.text.replace(/\r\n/g, "\n"));
    if (!reference.range) {
        return text;
    }
    return text
        .split("\n")
        .map((line, index) => `L${String(reference.range!.startLine + index)} | ${line}`)
        .join("\n");
}

function taskOp(task: Payload["task"]): "replace" | "insert_after" | "bridge" {
    if (task === "continue_after") {
        return "insert_after";
    }
    if (task === "bridge") {
        return "bridge";
    }
    return "replace";
}

function defaultInstruction(task: Payload["task"]): string {
    switch (task) {
        case "chat": return "根据当前要求处理，可直接修改目标文件。";
        case "rewrite": return "改写引用文本，保留核心信息。";
        case "polish": return "润色引用文本，改善表达与节奏。";
        case "expand": return "扩写引用文本，增加必要细节。";
        case "condense": return "缩写引用文本，保留关键信息。";
        case "continue_after": return "在引用文本之后续写。";
        case "bridge": return "补出承上启下的过渡文本。";
    }
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escapeCdata(value: string): string {
    return value.replace(/\]\]>/g, "]]]]><![CDATA[>");
}
