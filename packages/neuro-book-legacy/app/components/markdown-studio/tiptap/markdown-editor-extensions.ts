import {Placeholder} from "@tiptap/extension-placeholder";
import {TableKit} from "@tiptap/extension-table";
import {Image} from "@tiptap/extension-image";
import type {AnyExtension} from "@tiptap/core";
import {AgentHardBreak} from "nbook/app/components/novel-ide/agent/tiptap/AgentHardBreak";
import {AgentSkill} from "nbook/app/components/novel-ide/agent/tiptap/AgentSkillNode";
import type {AgentSuggestionMenuState} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {CommentItem} from "nbook/app/components/markdown-studio/tiptap/Comment";
import type {HtmlEmbedDataApi, HtmlEmbedLabels} from "nbook/app/components/markdown-studio/tiptap/HtmlEmbed";
import {createMarkdownDialectExtensions} from "nbook/app/components/markdown-studio/tiptap/markdown-dialect-extensions";
import {MarkdownInlineCodeShortcut} from "nbook/app/components/markdown-studio/tiptap/MarkdownInlineCodeShortcut";
import {MarkdownLink} from "nbook/app/components/markdown-studio/tiptap/MarkdownLink";
import {MarkdownSlashCommand} from "nbook/app/components/markdown-studio/tiptap/MarkdownSlashCommand";
import {createFallbackWorkspaceReferenceMeta, WorkspaceReference, type WorkspaceReferenceResolver} from "nbook/app/components/markdown-studio/tiptap/WorkspaceReference";

export interface MarkdownSuggestionController {
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    onMenuStateChange: (state: AgentSuggestionMenuState | null) => void;
    getMenuState: () => AgentSuggestionMenuState | null;
    getActiveIndex: () => number;
    setActiveIndex: (index: number) => void;
}

export interface MarkdownEditorExtensionOptions extends MarkdownSuggestionController {
    placeholder: string;
    openReference: (target: string) => void;
    onInlineCommentSelect?: (index: number) => void;
    /** 评论列表实质变化时回调（文档编辑、选区激活切换），由 Comment 插件按需触发 */
    onCommentsChange?: (comments: CommentItem[]) => void;
    /** <html> 嵌入卡片文案，宿主注入 i18n 结果 */
    resolveHtmlEmbedLabels?: () => HtmlEmbedLabels;
    /** <html> 嵌入块的宿主数据接口路由；不注入时 iframe 内数据请求统一拒绝 */
    resolveHtmlEmbedDataApi?: HtmlEmbedDataApi;
    sourcePath?: string;
    resolveReference?: WorkspaceReferenceResolver;
    enableQuickTriggers?: boolean;
}

/**
 * 完整 Markdown 编辑器扩展组。输入输出始终是 Markdown，包含项目自定义引用、评论、注音、双语对照和对齐语法。
 * 方言核心（基座 + 全部带 markdownTokenizer 的扩展）来自 createMarkdownDialectExtensions（与测试共用），
 * 本函数只追加编辑器 UI 层扩展（表格、图片、菜单、引用 chip 等）。
 *
 * ⚠️ tokenizer 执行顺序说明：marked 的 extension tokenizer 后注册者先执行，
 * MarkdownManager 按 TipTap priority 降序注册，因此 priority 越低的 tokenizer 越先执行。
 * HtmlBlock / RawInlineHtml 兜底扩展持最高 priority（最后执行），
 * 新增带 markdownTokenizer 的方言扩展时 priority 必须低于它们（1390/1400）。
 */
export function createMarkdownEditorExtensions(options: MarkdownEditorExtensionOptions): AnyExtension[] {
    return [
        ...createMarkdownDialectExtensions({
            comment: {
                onSelect: options.onInlineCommentSelect ?? (() => {}),
                onCommentsChange: options.onCommentsChange ?? (() => {}),
            },
            htmlEmbed: {
                ...(options.resolveHtmlEmbedLabels ? {resolveLabels: options.resolveHtmlEmbedLabels} : {}),
                ...(options.resolveHtmlEmbedDataApi ? {resolveDataApi: options.resolveHtmlEmbedDataApi} : {}),
            },
        }),
        TableKit,
        Image.configure({
            inline: true,
            allowBase64: false,
            HTMLAttributes: {
                class: "nb-markdown-image-node",
            },
        }),
        AgentHardBreak,
        Placeholder.configure({
            placeholder: options.placeholder,
            emptyEditorClass: "is-editor-empty",
        }),
        MarkdownInlineCodeShortcut,
        MarkdownLink.configure({
            openOnClick: true,
            enableClickSelection: true,
            linkOnPaste: false,
        }),
        WorkspaceReference.configure({
            resolveMenu: options.resolveMenu,
            onMenuStateChange: options.onMenuStateChange,
            getMenuState: options.getMenuState,
            getActiveIndex: options.getActiveIndex,
            setActiveIndex: options.setActiveIndex,
            openReference: options.openReference,
            sourcePath: options.sourcePath ?? "",
            resolveReference: options.resolveReference ?? createFallbackWorkspaceReferenceMeta,
        }),
        MarkdownSlashCommand.configure({
            resolveMenu: options.resolveMenu,
            onMenuStateChange: options.onMenuStateChange,
            getMenuState: options.getMenuState,
            getActiveIndex: options.getActiveIndex,
            setActiveIndex: options.setActiveIndex,
        }),
        ...(options.enableQuickTriggers ? [AgentSkill.configure({
            resolveMenu: options.resolveMenu,
            onMenuStateChange: options.onMenuStateChange,
            getMenuState: options.getMenuState,
            getActiveIndex: options.getActiveIndex,
            setActiveIndex: options.setActiveIndex,
        })] : []),
    ];
}
