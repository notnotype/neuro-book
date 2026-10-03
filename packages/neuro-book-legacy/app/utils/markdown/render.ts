import {Marked} from "marked";
import {renderReferenceChipHtml} from "nbook/app/components/common/reference-chip";
import {parseSelectionRefChip} from "nbook/app/utils/inline-editor-selection";
import {renderInlineCommentHtml} from "nbook/app/utils/structured-text";
import {parseWorkspaceReferenceLink} from "nbook/shared/workspace-reference";

/**
 * 转义 HTML。
 */
export const escapeHtml = (unsafeString: string): string => unsafeString
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

/**
 * 计算未闭合的代码块数量。
 */
export const countCodeFences = (text: string): number => {
    const matches = text.match(/^```/gm);
    return matches ? matches.length : 0;
};

const GFM_TABLE_SEPARATOR_CELL_PATTERN = /^:?-{3,}:?$/;

/**
 * 判断一行是否像 GFM 表格行。
 */
function isLooseGfmTableRow(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.includes("|") && (readLooseGfmCells(line).length > 1 || (trimmed.startsWith("|") && trimmed.endsWith("|")));
}

/**
 * 读取 GFM 表格行的单元格内容。
 */
function readLooseGfmCells(line: string): string[] {
    const trimmed = line.trim();
    const withoutLeftPipe = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
    const withoutPipes = withoutLeftPipe.endsWith("|") ? withoutLeftPipe.slice(0, -1) : withoutLeftPipe;
    return withoutPipes.split("|").map((cell) => cell.trim());
}

/**
 * 判断一行是否像 GFM 表格分隔行。
 */
function isLooseGfmSeparator(line: string): boolean {
    if (!isLooseGfmTableRow(line)) {
        return false;
    }

    const cells = readLooseGfmCells(line);
    return cells.length > 0 && cells.every((cell) => GFM_TABLE_SEPARATOR_CELL_PATTERN.test(cell));
}

/**
 * 渲染宽松 GFM 表格行。
 */
function renderLooseGfmRow(cells: string[]): string {
    return `| ${cells.join(" | ")} |`;
}

/**
 * 修复 LLM 流式输出中列数不一致的 GFM 表格头。
 */
export const normalizeLooseGfmTables = (text: string): string => {
    const lines = text.split("\n");
    const normalized: string[] = [];
    let inFence = false;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line === undefined) {
            continue;
        }
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
            normalized.push(line);
            continue;
        }

        const nextLine = lines[index + 1];
        if (!inFence && nextLine && isLooseGfmTableRow(line) && isLooseGfmSeparator(nextLine)) {
            const headerCells = readLooseGfmCells(line);
            const separatorCells = readLooseGfmCells(nextLine);
            const columnCount = Math.max(headerCells.length, separatorCells.length);

            while (headerCells.length < columnCount) {
                headerCells.push("");
            }
            while (separatorCells.length < columnCount) {
                separatorCells.push("---");
            }

            normalized.push(renderLooseGfmRow(headerCells));
            normalized.push(renderLooseGfmRow(separatorCells));
            index += 1;
            continue;
        }

        normalized.push(line);
    }

    return normalized.join("\n");
};

/**
 * 处理由于流式接收导致的 Markdown 未闭合代码块问题。
 */
export const normalizeStreamingMarkdown = (text: string): string => {
    const lines = text.split("\n");
    let markdown = normalizeLooseGfmTables(lines.join("\n"));
    const openFences = countCodeFences(markdown);
    if (openFences % 2 !== 0) {
        markdown += "\n```";
    }
    return markdown;
};

/**
 * 简单渲染纯文本回车为 HTML。
 */
export const renderPlainTextHtml = (text: string): string => {
    return `<div class="whitespace-pre-wrap">${escapeHtml(text)}</div>`;
};

let markedInitialized = false;
const agentMarkdown = new Marked();
const WORKSPACE_REFERENCE_PATTERN = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/;

/**
 * 初始化 Agent 聊天气泡专用 markdown 渲染器。
 */
function ensureMarked(): void {
    if (markedInitialized) {
        return;
    }

    const renderer = new agentMarkdown.Renderer();
    renderer.link = ({href, title, text}) => {
        const rawLink = `[${text}](${href ?? ""})`;
        const reference = parseWorkspaceReferenceLink(rawLink);
        if (reference) {
            return renderReferenceChipHtml(reference);
        }

        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a href="${escapeHtml(href ?? "")}"${titleAttr}>${text}</a>`;
    };

    agentMarkdown.setOptions({
        gfm: true,
        breaks: true,
        renderer,
    });
    agentMarkdown.use({
        extensions: [
            {
                name: "selectionReference",
                level: "inline",
                start(src: string) {
                    const bracketedIndex = src.indexOf("[[");
                    const lineIndex = src.search(/[\w@~.-][\w@~./\\-]*[\/\\][\w@~./\\-]*#(?:L)?\d/u);
                    if (bracketedIndex < 0) {
                        return lineIndex < 0 ? undefined : lineIndex;
                    }
                    if (lineIndex < 0) {
                        return bracketedIndex;
                    }
                    return Math.min(bracketedIndex, lineIndex);
                },
                tokenizer(src: string) {
                    const chip = parseSelectionRefChip(src);
                    if (!chip) {
                        return undefined;
                    }
                    return {
                        type: "selectionReference",
                        raw: chip.raw,
                        href: chip.path,
                        text: chip.label,
                    };
                },
                renderer(token) {
                    const raw = token.raw ?? "";
                    const chip = parseSelectionRefChip(raw);
                    if (!chip) {
                        return raw;
                    }
                    return renderReferenceChipHtml({
                        label: chip.label,
                        target: chip.path,
                        entryType: "selection",
                        icon: "i-lucide-text-select",
                    });
                },
            },
            {
                name: "workspaceReference",
                level: "inline",
                start(src: string) {
                    return src.indexOf("[");
                },
                tokenizer(src: string) {
                    const matched = WORKSPACE_REFERENCE_PATTERN.exec(src);
                    const rawLink = matched?.[0] ?? "";
                    const reference = rawLink ? parseWorkspaceReferenceLink(rawLink) : null;
                    if (!matched || !reference) {
                        return undefined;
                    }

                    return {
                        type: "workspaceReference",
                        raw: rawLink,
                        href: reference.target,
                        text: reference.label,
                    };
                },
                renderer(token) {
                    const rawLink = token.raw || `[${token.text ?? ""}](${token.href ?? ""})`;
                    const reference = parseWorkspaceReferenceLink(rawLink);
                    if (!reference) {
                        return rawLink;
                    }

                    return renderReferenceChipHtml(reference);
                },
            },
            {
                name: "inlineComment",
                level: "inline",
                start(src: string) {
                    const commentIndex = src.indexOf("<comment");
                    const legacyIndex = src.indexOf("<inline-comment");
                    if (commentIndex < 0) {
                        return legacyIndex;
                    }
                    return legacyIndex < 0 ? commentIndex : Math.min(commentIndex, legacyIndex);
                },
                tokenizer(src: string) {
                    // canonical <comment>，兼容旧 <inline-comment>；开闭标签名一致（反向引用）
                    const matched = /^<(comment|inline-comment)(?:\s+[^>]*)?>[\s\S]*?<\/\1>/.exec(src);
                    if (!matched) {
                        return undefined;
                    }

                    return {
                        type: "inlineComment",
                        raw: matched[0],
                        text: matched[0],
                    };
                },
                renderer(token) {
                    return renderInlineCommentHtml(token.raw);
                },
            },
        ],
    });
    markedInitialized = true;
}

/**
 * 渲染 Markdown。
 */
export const renderMarkdown = (content: string, sanitizeHtml?: (html: string) => string): string => {
    if (!content.trim()) {
        return "";
    }

    ensureMarked();
    const html = agentMarkdown.parse(normalizeStreamingMarkdown(content)) as string;
    return sanitizeHtml ? sanitizeHtml(html) : html;
};
