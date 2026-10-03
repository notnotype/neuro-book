import {mergeAttributes, Node, type Editor, type Range} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {PluginKey} from "@tiptap/pm/state";
import {Suggestion, type SuggestionMatch} from "@tiptap/suggestion";
import {getReferenceChipMeta} from "nbook/app/components/common/reference-chip";
import type {AgentTriggerMenuContext, AgentTriggerMenuItem, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {AgentSuggestionController} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import {
    createAgentSuggestionRenderer,
    expandSuggestionRange,
    flattenAgentSuggestionItems,
} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import {
    buildWorkspaceReferenceMarkdown,
    isWorkspaceReferenceTarget,
} from "nbook/shared/workspace-reference";

interface WorkspaceReferenceToken extends MarkdownToken {
    label?: string;
    target?: string;
}

export interface WorkspaceReferencePreviewMeta {
    target: string;
    resolvedPath: string | null;
    entryType: string | null;
    icon: string | null;
    title: string;
    status: string | null;
    broken: boolean;
    contentNode: boolean;
    isDirectory: boolean;
}

export type WorkspaceReferenceResolver = (target: string, sourcePath: string) => WorkspaceReferencePreviewMeta;

interface WorkspaceReferenceOptions extends AgentSuggestionController {
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    openReference: (target: string) => void;
    sourcePath: string;
    resolveReference: WorkspaceReferenceResolver;
}

const WORKSPACE_LINK_PATTERN = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/;
const DOMAIN_REFERENCE_TARGET_PATTERN = /^(?:chapter|volume|lorebook|thread|scene|plot|pending):\/\/[^)\s]+$/i;
const workspaceReferencePluginKey = new PluginKey("workspace-reference-trigger");
const workspaceReferenceNodeViews = new Set<() => void>();

/**
 * 默认引用解析结果。没有接入 workspace tree 时仍按普通文件 chip 展示。
 */
export function createFallbackWorkspaceReferenceMeta(target: string): WorkspaceReferencePreviewMeta {
    return {
        target,
        resolvedPath: null,
        entryType: null,
        icon: null,
        title: "",
        status: null,
        broken: false,
        contentNode: false,
        isDirectory: false,
    };
}

/**
 * 外部 workspace tree 变化后重绘当前引用节点，不修改 ProseMirror 文档。
 */
export function refreshWorkspaceReferenceNodes(): void {
    for (const rerender of workspaceReferenceNodeViews) {
        rerender();
    }
}

/**
 * 工作区 Markdown link 的富文本节点。
 * ProseMirror 中是 Notion-like inline atom，保存时仍序列化回 `[label](target)` Markdown。
 */
export const WorkspaceReference = Node.create<WorkspaceReferenceOptions>({
    name: "workspaceReference",
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    priority: 1190,

    addOptions() {
        return {
            resolveMenu: () => ({
                title: "",
                prefix: "",
                sections: [],
            }),
            onMenuStateChange: () => {},
            getMenuState: () => null,
            getActiveIndex: () => 0,
            setActiveIndex: () => {},
            openReference: () => {},
            sourcePath: "",
            resolveReference: createFallbackWorkspaceReferenceMeta,
        };
    },

    addAttributes() {
        return {
            label: {
                default: "",
            },
            target: {
                default: "",
            },
        };
    },

    parseHTML() {
        return [{
            tag: "span[data-workspace-reference-target]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {
                    label: element.dataset.workspaceReferenceLabel ?? element.textContent?.trim() ?? "",
                    target: element.dataset.workspaceReferenceTarget ?? "",
                };
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        return ["span", mergeAttributes(HTMLAttributes, {
            "data-workspace-reference-label": HTMLAttributes.label,
            "data-workspace-reference-target": HTMLAttributes.target,
            contenteditable: "false",
        })];
    },

    addNodeView() {
        return ({node, editor}) => {
            let currentNode = node;
            const wrapper = createWorkspaceReferenceElement({
                label: String(node.attrs.label ?? ""),
                target: String(node.attrs.target ?? ""),
                sourcePath: this.options.sourcePath,
                resolveReference: this.options.resolveReference,
                openReference: this.options.openReference,
                editor,
            });
            const rerender = (): void => {
                renderWorkspaceReferenceElement(wrapper, {
                    label: String(currentNode.attrs.label ?? ""),
                    target: String(currentNode.attrs.target ?? ""),
                    sourcePath: this.options.sourcePath,
                    resolveReference: this.options.resolveReference,
                    openReference: this.options.openReference,
                });
            };
            workspaceReferenceNodeViews.add(rerender);
            return {
                dom: wrapper,
                update: (nextNode) => {
                    if (nextNode.type.name !== this.name) {
                        return false;
                    }
                    currentNode = nextNode;
                    rerender();
                    return true;
                },
                destroy: () => {
                    workspaceReferenceNodeViews.delete(rerender);
                },
                stopEvent: (event) => event.type === "dblclick" || isOpenReferenceClick(event),
            };
        };
    },

    markdownTokenizer: {
        name: "workspaceReference",
        level: "inline",
        start(src: string) {
            return findWorkspaceLinkStart(src);
        },
        tokenize(src: string) {
            const matched = WORKSPACE_LINK_PATTERN.exec(src);
            const label = matched?.[1]?.trim() ?? "";
            const target = matched?.[2]?.trim() ?? "";
            if (!matched || !label || !isDomainReferenceTarget(target)) {
                return undefined;
            }

            return {
                type: "workspaceReference",
                raw: matched[0],
                label,
                target,
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const referenceToken = token as WorkspaceReferenceToken;
        return helpers.createNode("workspaceReference", {
            label: referenceToken.label ?? "",
            target: referenceToken.target ?? "",
        });
    },

    renderMarkdown: (node) => {
        return buildWorkspaceReferenceMarkdown({
            label: String(node.attrs?.label ?? ""),
            target: String(node.attrs?.target ?? ""),
        });
    },

    renderText: ({node}) => {
        return buildWorkspaceReferenceMarkdown({
            label: String(node.attrs?.label ?? ""),
            target: String(node.attrs?.target ?? ""),
        });
    },

    addKeyboardShortcuts() {
        return {
            Backspace: () => this.editor.state.selection.empty
                && degradeAdjacentReference(this.editor.state.selection.from, -1, this.editor),
            Delete: () => this.editor.state.selection.empty
                && degradeAdjacentReference(this.editor.state.selection.from, 1, this.editor),
        };
    },

    addProseMirrorPlugins() {
        let currentMenuState: AgentTriggerMenuState | null = null;
        return [Suggestion({
            editor: this.editor,
            pluginKey: workspaceReferencePluginKey,
            char: "@",
            allow: ({state, range}) => {
                if (!state.selection.empty) {
                    return false;
                }
                const referenceNodeType = state.schema.nodes[this.name];
                if (!referenceNodeType) {
                    return false;
                }
                const $from = state.doc.resolve(range.from);
                return !!$from.parent.type.contentMatch.matchType(referenceNodeType);
            },
            findSuggestionMatch: ({$position}): SuggestionMatch => {
                const text = $position.nodeBefore?.isText ? $position.nodeBefore.text ?? "" : "";
                if (!text) {
                    return null;
                }
                const matched = /(?:^|[\s(])(@[^\s)]*)$/u.exec(text);
                const raw = matched?.[1];
                if (!raw) {
                    return null;
                }
                const textStart = $position.pos - text.length;
                const from = textStart + text.length - raw.length;
                return {
                    range: {
                        from,
                        to: $position.pos,
                    },
                    query: raw.slice(1),
                    text: raw,
                };
            },
            items: ({query}) => {
                currentMenuState = this.options.resolveMenu({
                    kind: "reference-root",
                    query,
                });
                return flattenAgentSuggestionItems(currentMenuState.sections);
            },
            render: createAgentSuggestionRenderer({
                pluginKey: workspaceReferencePluginKey,
                controller: this.options,
                contextKind: "reference-root",
                resolveMenuState: (query) => {
                    if (!currentMenuState) {
                        currentMenuState = this.options.resolveMenu({
                            kind: "reference-root",
                            query,
                        });
                    }
                    return currentMenuState;
                },
            }),
            command: ({editor, range, props}) => {
                insertWorkspaceReference({
                    editor,
                    range,
                    item: props,
                    nodeName: this.name,
                });
            },
        })];
    },
});

/**
 * 将菜单项插入为工作区引用节点。
 */
function insertWorkspaceReference(options: {
    editor: Editor;
    range: Range;
    item: AgentTriggerMenuItem;
    nodeName: string;
}): void {
    const reference = normalizeReferenceMenuValue(options.item);
    if (!reference || options.item.disabled) {
        return;
    }
    const nextRange = expandSuggestionRange(options.editor, options.range, true);
    options.editor.chain().focus().insertContentAt(nextRange, [
        {
            type: options.nodeName,
            attrs: {
                label: reference.label,
                target: reference.target,
            },
        },
        {
            type: "text",
            text: " ",
        },
    ]).run();
}

/**
 * 查找不是 Markdown 图片一部分的工作区链接起点。
 */
function findWorkspaceLinkStart(src: string): number {
    for (let index = src.indexOf("["); index >= 0; index = src.indexOf("[", index + 1)) {
        if (index === 0 || src[index - 1] !== "!") {
            return index;
        }
    }
    return -1;
}

/**
 * 菜单项可以来自 workspace path 引用，也可以来自旧 scheme 引用。
 */
function normalizeReferenceMenuValue(item: AgentTriggerMenuItem): {
    label: string;
    target: string;
} | null {
    if (item.workspaceReference) {
        return {
            label: item.workspaceReference.label,
            target: item.workspaceReference.target,
        };
    }

    if (!item.reference) {
        return null;
    }

    return {
        label: item.reference.title,
        target: `${item.reference.kind}://${item.reference.targetId}`,
    };
}

/**
 * 将紧邻光标的引用节点退化成 Markdown 文本，方便继续编辑源码。
 */
function degradeAdjacentReference(position: number, direction: -1 | 1, editor: Editor): boolean {
    const resolved = editor.state.doc.resolve(position);
    const adjacentNode = direction < 0 ? resolved.nodeBefore : resolved.nodeAfter;
    if (!adjacentNode || adjacentNode.type?.name !== "workspaceReference") {
        return false;
    }
    const markdown = buildWorkspaceReferenceMarkdown({
        label: String(adjacentNode.attrs?.label ?? ""),
        target: String(adjacentNode.attrs?.target ?? ""),
    });
    const from = direction < 0 ? position - adjacentNode.nodeSize : position;
    const to = direction < 0 ? position : position + adjacentNode.nodeSize;

    editor.chain().focus().insertContentAt({from, to}, markdown).run();
    editor.commands.setTextSelection(direction < 0 ? from + markdown.length : from);
    return true;
}

/**
 * 创建工作区引用节点 DOM。
 */
function createWorkspaceReferenceElement(options: {
    label: string;
    target: string;
    sourcePath: string;
    resolveReference: WorkspaceReferenceResolver;
    openReference: (target: string) => void;
    editor: Editor;
}): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "nb-workspace-reference-node";
    wrapper.contentEditable = "false";
    renderWorkspaceReferenceElement(wrapper, options);
    wrapper.addEventListener("click", (event) => {
        if (!(event instanceof MouseEvent) || (!event.ctrlKey && !event.metaKey)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        openWorkspaceReferenceFromElement(wrapper, options.openReference);
        options.editor.commands.focus();
    });
    wrapper.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openWorkspaceReferenceFromElement(wrapper, options.openReference);
        options.editor.commands.focus();
    });
    return wrapper;
}

/**
 * 根据当前属性重绘 chip DOM。
 */
function renderWorkspaceReferenceElement(wrapper: HTMLElement, options: {
    label: string;
    target: string;
    sourcePath: string;
    resolveReference: WorkspaceReferenceResolver;
    openReference: (target: string) => void;
}): void {
    const meta = options.resolveReference(options.target, options.sourcePath);
    wrapper.dataset.workspaceReferenceLabel = options.label;
    wrapper.dataset.workspaceReferenceTarget = options.target;
    wrapper.dataset.workspaceReferenceOpenTarget = meta.resolvedPath ?? options.target;
    wrapper.replaceChildren(createReferenceChipElement({
        label: options.label,
        target: options.target,
        reference: meta,
    }));
}

/**
 * 打开当前节点解析后的目标路径。
 */
function openWorkspaceReferenceFromElement(wrapper: HTMLElement, openReference: (target: string) => void): void {
    const target = wrapper.dataset.workspaceReferenceOpenTarget ?? wrapper.dataset.workspaceReferenceTarget ?? "";
    if (target) {
        openReference(target);
    }
}

/**
 * 创建 ReferenceChip 对应 DOM，不在 node view 中挂 Vue 实例。
 */
function createReferenceChipElement(options: {
    label: string;
    target: string;
    reference: WorkspaceReferencePreviewMeta;
}): HTMLElement {
    const meta = getReferenceChipMeta({
        target: options.reference.resolvedPath ?? options.target,
        entryType: options.reference.entryType,
        icon: options.reference.icon,
        broken: options.reference.broken,
    });
    const chip = document.createElement("span");
    chip.className = `nb-reference-chip ${meta.toneClass}`;
    chip.dataset.referenceTarget = options.reference.resolvedPath ?? options.target;
    chip.dataset.referenceEntryType = options.reference.entryType ?? "";
    chip.title = options.reference.resolvedPath ? `${options.target} -> ${options.reference.resolvedPath}` : options.target;

    const icon = document.createElement("span");
    icon.className = `nb-reference-chip__icon ${meta.iconClass}`;
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "nb-reference-chip__label";
    label.textContent = options.reference.title || options.label;

    const badge = document.createElement("span");
    badge.className = "nb-reference-chip__badge";
    badge.textContent = meta.badgeLabel;

    chip.append(icon, label, badge);
    return chip;
}

/**
 * 引用节点只拦截显式打开动作，其余点击交给 ProseMirror 放置光标。
 */
function isOpenReferenceClick(event: Event): boolean {
    return event instanceof MouseEvent
        && event.type === "click"
        && (event.ctrlKey || event.metaKey);
}

/**
 * 领域 Markdown 引用包含 workspace path 与剧情对象 scheme。
 */
function isDomainReferenceTarget(target: string): boolean {
    return isWorkspaceReferenceTarget(target) || DOMAIN_REFERENCE_TARGET_PATTERN.test(target);
}
