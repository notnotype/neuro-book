import {Extension, mergeAttributes, Node, type Editor, type Range} from "@tiptap/core";
import {Placeholder} from "@tiptap/extension-placeholder";
import {PluginKey} from "@tiptap/pm/state";
import {StarterKit} from "@tiptap/starter-kit";
import {Suggestion, type SuggestionMatch} from "@tiptap/suggestion";
import type {AnyExtension} from "@tiptap/core";
import {getReferenceChipMeta} from "nbook/app/components/common/reference-chip";
import type {AgentTriggerMenuContext, AgentTriggerMenuItem, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import {AgentHardBreak} from "nbook/app/components/novel-ide/agent/tiptap/AgentHardBreak";
import {AgentSkill} from "nbook/app/components/novel-ide/agent/tiptap/AgentSkillNode";
import type {AgentSuggestionController} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import {
    createAgentSuggestionRenderer,
    expandSuggestionRange,
    flattenAgentSuggestionItems,
} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import {findAgentTriggerMatch} from "nbook/shared/reference-trigger";

type ReferenceTriggerKind = Extract<AgentTriggerMenuContext["kind"], "reference-root" | "chapter" | "volume" | "lorebook" | "thread" | "scene">;

export interface PlainReferenceTextExtensionOptions extends AgentSuggestionController {
    placeholder: string;
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    enableQuickTriggers: boolean;
    onPendingImageRetry: (uploadId: string) => void;
    onPendingImageRemove: (uploadId: string) => void;
}

interface PlainPendingImageOptions {
    onRetry: (uploadId: string) => void;
    onRemove: (uploadId: string) => void;
}

interface PlainReferenceOptions extends AgentSuggestionController {
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    suggestions: Array<{
        kind: ReferenceTriggerKind;
        pluginKey: PluginKey;
    }>;
}

interface PlainSlashCommandOptions extends AgentSuggestionController {
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
}

const plainSlashCommandPluginKey = new PluginKey("plain-slash-command");

/**
 * 创建纯文本引用输入器的轻量 TipTap 扩展。
 */
export function createPlainReferenceTextExtensions(options: PlainReferenceTextExtensionOptions): AnyExtension[] {
    return [
        StarterKit.configure({
            blockquote: false,
            bold: false,
            bulletList: false,
            code: false,
            codeBlock: false,
            dropcursor: false,
            gapcursor: false,
            hardBreak: false,
            heading: false,
            horizontalRule: false,
            italic: false,
            link: false,
            listItem: false,
            orderedList: false,
            strike: false,
            trailingNode: false,
            underline: false,
        }),
        AgentHardBreak,
        Placeholder.configure({
            placeholder: options.placeholder,
            emptyEditorClass: "is-editor-empty",
        }),
        PlainReference.configure({
            resolveMenu: options.resolveMenu,
            onMenuStateChange: options.onMenuStateChange,
            getMenuState: options.getMenuState,
            getActiveIndex: options.getActiveIndex,
            setActiveIndex: options.setActiveIndex,
        }),
        PlainSelectionReference,
        PlainImage,
        PlainPendingImage.configure({
            onRetry: options.onPendingImageRetry,
            onRemove: options.onPendingImageRemove,
        }),
        PlainSlashCommand.configure({
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

/**
 * 纯文本引用节点。只负责 inline atom 与 @ trigger，不注册 Markdown tokenizer。
 */
const PlainReference = Node.create<PlainReferenceOptions>({
    name: "plainReference",
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
            suggestions: [
                {kind: "reference-root", pluginKey: new PluginKey("plain-reference-root")},
                {kind: "chapter", pluginKey: new PluginKey("plain-reference-chapter")},
                {kind: "volume", pluginKey: new PluginKey("plain-reference-volume")},
                {kind: "lorebook", pluginKey: new PluginKey("plain-reference-lorebook")},
                {kind: "thread", pluginKey: new PluginKey("plain-reference-thread")},
                {kind: "scene", pluginKey: new PluginKey("plain-reference-scene")},
            ],
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
            entryType: {
                default: null,
            },
            icon: {
                default: null,
            },
        };
    },

    parseHTML() {
        return [{
            tag: "span[data-plain-reference-target]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {
                    label: element.dataset.plainReferenceLabel ?? element.textContent?.trim() ?? "",
                    target: element.dataset.plainReferenceTarget ?? "",
                    entryType: element.dataset.plainReferenceEntryType || null,
                    icon: element.dataset.plainReferenceIcon || null,
                };
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        return ["span", mergeAttributes(HTMLAttributes, {
            "data-plain-reference-label": HTMLAttributes.label,
            "data-plain-reference-target": HTMLAttributes.target,
            "data-plain-reference-entry-type": HTMLAttributes.entryType,
            "data-plain-reference-icon": HTMLAttributes.icon,
            contenteditable: "false",
        })];
    },

    addNodeView() {
        return ({node}) => ({
            dom: createReferenceElement({
                label: String(node.attrs.label ?? ""),
                target: String(node.attrs.target ?? ""),
                entryType: typeof node.attrs.entryType === "string" ? node.attrs.entryType : null,
                icon: typeof node.attrs.icon === "string" ? node.attrs.icon : null,
            }),
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
        return this.options.suggestions.map((suggestion) => {
            let currentMenuState: AgentTriggerMenuState | null = null;
            return Suggestion({
                editor: this.editor,
                pluginKey: suggestion.pluginKey,
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
                    const matched = findAgentTriggerMatch(text, suggestion.kind);
                    if (!matched) {
                        return null;
                    }
                    const textStart = $position.pos - text.length;
                    return {
                        range: {
                            from: textStart + matched.from,
                            to: textStart + matched.to,
                        },
                        query: matched.query,
                        text: matched.text,
                    };
                },
                items: ({query}) => {
                    currentMenuState = this.options.resolveMenu({
                        kind: suggestion.kind,
                        query,
                    });
                    return flattenAgentSuggestionItems(currentMenuState.sections);
                },
                render: createAgentSuggestionRenderer({
                    pluginKey: suggestion.pluginKey,
                    controller: this.options,
                    contextKind: suggestion.kind,
                    resolveMenuState: (query) => {
                        if (!currentMenuState) {
                            currentMenuState = this.options.resolveMenu({
                                kind: suggestion.kind,
                                query,
                            });
                        }
                        return currentMenuState;
                    },
                }),
                command: ({editor, range, props}) => {
                    insertPlainReferenceSuggestion({
                        editor,
                        range,
                        item: props,
                        nodeName: this.name,
                    });
                },
            });
        });
    },
});

/**
 * Inline AI 选区引用节点。只展示 canonical [[path#Lx-Ly]] chip，不参与 @ trigger。
 */
const PlainSelectionReference = Node.create({
    name: "plainSelectionReference",
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    priority: 1185,

    addAttributes() {
        return {
            label: {
                default: "",
            },
            target: {
                default: "",
            },
            ref: {
                default: "",
            },
            startLine: {
                default: null,
            },
            endLine: {
                default: null,
            },
        };
    },

    parseHTML() {
        return [{
            tag: "span[data-plain-selection-reference-target]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {
                    label: element.dataset.plainSelectionReferenceLabel ?? element.textContent?.trim() ?? "",
                    target: element.dataset.plainSelectionReferenceTarget ?? "",
                    ref: element.dataset.plainSelectionReferenceRef ?? "",
                    startLine: element.dataset.plainSelectionReferenceStartLine || null,
                    endLine: element.dataset.plainSelectionReferenceEndLine || null,
                };
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        return ["span", mergeAttributes(HTMLAttributes, {
            "data-plain-selection-reference-label": HTMLAttributes.label,
            "data-plain-selection-reference-target": HTMLAttributes.target,
            "data-plain-selection-reference-ref": HTMLAttributes.ref,
            "data-plain-selection-reference-start-line": HTMLAttributes.startLine,
            "data-plain-selection-reference-end-line": HTMLAttributes.endLine,
            contenteditable: "false",
        })];
    },

    addNodeView() {
        return ({node}) => ( {
            dom: createReferenceElement({
                label: String(node.attrs.label ?? ""),
                target: String(node.attrs.target ?? ""),
                entryType: "selection",
                icon: "i-lucide-text-select",
                wrapperClass: "nb-plain-selection-reference-node",
                dataset: {
                    plainSelectionReferenceLabel: String(node.attrs.label ?? ""),
                    plainSelectionReferenceTarget: String(node.attrs.target ?? ""),
                    plainSelectionReferenceRef: String(node.attrs.ref ?? ""),
                    plainSelectionReferenceStartLine: String(node.attrs.startLine ?? ""),
                    plainSelectionReferenceEndLine: String(node.attrs.endLine ?? ""),
                },
            }),
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
});

/** 已上传图片的稳定 inline chip；正文仍只序列化 Markdown。 */
const PlainImage = Node.create({
    name: "plainImage",
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    priority: 1180,

    addAttributes() {
        return {
            label: {default: ""},
            target: {default: ""},
            attachmentId: {default: null},
            mimeType: {default: null},
            bytes: {default: null},
            name: {default: null},
            locatorEntryId: {default: null},
            locatorContentIndex: {default: null},
        };
    },

    parseHTML() {
        return [{tag: "span[data-plain-image-target]"}];
    },

    renderHTML({HTMLAttributes}) {
        return ["span", mergeAttributes(HTMLAttributes, {
            "data-plain-image-label": HTMLAttributes.label,
            "data-plain-image-target": HTMLAttributes.target,
            contenteditable: "false",
        })];
    },

    addNodeView() {
        return ({node}) => ({dom: createImageChipElement({
            label: String(node.attrs.label ?? "") || "图片",
            target: String(node.attrs.target ?? ""),
        })});
    },
});

/** 上传期间的临时节点；不进入 modelValue、localStorage 或 HTTP 正文。 */
const PlainPendingImage = Node.create<PlainPendingImageOptions>({
    name: "plainPendingImage",
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    priority: 1175,

    addOptions() {
        return {
            onRetry: () => {},
            onRemove: () => {},
        };
    },

    addAttributes() {
        return {
            uploadId: {default: ""},
            name: {default: ""},
            status: {default: "uploading"},
            error: {default: ""},
        };
    },

    parseHTML() {
        return [{tag: "span[data-plain-pending-image-id]"}];
    },

    renderHTML({HTMLAttributes}) {
        return ["span", mergeAttributes(HTMLAttributes, {
            "data-plain-pending-image-id": HTMLAttributes.uploadId,
            contenteditable: "false",
        })];
    },

    addNodeView() {
        return ({node}) => {
            const dom = document.createElement("span");
            const render = (currentNode: typeof node): void => {
                const uploadId = String(currentNode.attrs.uploadId ?? "");
                const status = currentNode.attrs.status === "failed" ? "failed" : "uploading";
                dom.className = `nb-plain-pending-image-node is-${status}`;
                dom.dataset.plainPendingImageId = uploadId;
                dom.contentEditable = "false";
                dom.title = status === "failed"
                    ? String(currentNode.attrs.error ?? "图片上传失败")
                    : "图片上传中";
                dom.replaceChildren();

                const icon = document.createElement("span");
                icon.className = status === "failed" ? "i-lucide-image-off" : "i-lucide-loader-circle nb-plain-pending-image-node__spin";
                const label = document.createElement("span");
                label.className = "nb-plain-pending-image-node__label";
                label.textContent = String(currentNode.attrs.name ?? "图片");
                dom.append(icon, label);

                if (status === "failed") {
                    const retry = document.createElement("button");
                    retry.type = "button";
                    retry.className = "nb-plain-pending-image-node__action";
                    retry.textContent = "重试";
                    retry.addEventListener("click", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.options.onRetry(uploadId);
                    });
                    dom.append(retry);
                }

                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "nb-plain-pending-image-node__remove";
                remove.setAttribute("aria-label", "移除图片");
                remove.textContent = "×";
                remove.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.options.onRemove(uploadId);
                });
                dom.append(remove);
            };
            render(node);
            return {
                dom,
                update: (nextNode) => {
                    if (nextNode.type.name !== this.name) {
                        return false;
                    }
                    render(nextNode);
                    return true;
                },
            };
        };
    },
});

/**
 * 纯文本 / 命令入口。只插入普通文本，不执行 Markdown 格式命令。
 */
const PlainSlashCommand = Extension.create<PlainSlashCommandOptions>({
    name: "plainSlashCommand",

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
        };
    },

    addProseMirrorPlugins() {
        let currentMenuState: AgentTriggerMenuState | null = null;
        let hasPlainTextBeforeTrigger = false;
        return [Suggestion({
            editor: this.editor,
            pluginKey: plainSlashCommandPluginKey,
            char: "/",
            allow: ({state}) => state.selection.empty,
            findSuggestionMatch: ({$position}): SuggestionMatch => {
                const text = $position.nodeBefore?.isText ? $position.nodeBefore.text ?? "" : "";
                if (!text) {
                    return null;
                }
                const matched = findAgentTriggerMatch(text, "command");
                if (!matched) {
                    return null;
                }
                hasPlainTextBeforeTrigger = matched.hasPlainTextBeforeTrigger;
                const textStart = $position.pos - text.length;
                return {
                    range: {
                        from: textStart + matched.from,
                        to: textStart + matched.to,
                    },
                    query: matched.query,
                    text: matched.text,
                };
            },
            items: ({query}) => {
                currentMenuState = this.options.resolveMenu({
                    kind: "command",
                    query,
                    hasPlainTextBeforeTrigger,
                });
                return flattenAgentSuggestionItems(currentMenuState.sections);
            },
            render: createAgentSuggestionRenderer({
                pluginKey: plainSlashCommandPluginKey,
                controller: this.options,
                contextKind: "command",
                resolveContext: (query) => ({
                    kind: "command",
                    query,
                    hasPlainTextBeforeTrigger,
                }),
                resolveMenuState: (query) => {
                    if (!currentMenuState) {
                        currentMenuState = this.options.resolveMenu({
                            kind: "command",
                            query,
                            hasPlainTextBeforeTrigger,
                        });
                    }
                    return currentMenuState;
                },
            }),
            command: ({editor, range, props}) => {
                insertPlainTextSuggestion(editor, range, props);
            },
        })];
    },
});

function insertPlainReferenceSuggestion(options: {
    editor: Editor;
    range: Range;
    item: AgentTriggerMenuItem;
    nodeName: string;
}): void {
    if (options.item.disabled) {
        return;
    }

    if (options.item.action) {
        const nextRange = expandSuggestionRange(options.editor, options.range, false);
        options.editor.chain().focus().deleteRange(nextRange).setTextSelection(nextRange.from).run();
        void options.item.action({position: nextRange.from});
        return;
    }

    const reference = normalizeReferenceMenuValue(options.item);
    if (reference) {
        const nextRange = expandSuggestionRange(options.editor, options.range, true);
        options.editor.chain().focus().insertContentAt(nextRange, [
            {
                type: options.nodeName,
                attrs: reference,
            },
            {
                type: "text",
                text: " ",
            },
        ]).run();
        return;
    }

    insertPlainTextSuggestion(options.editor, options.range, options.item);
}

function insertPlainTextSuggestion(editor: Editor, range: Range, item: AgentTriggerMenuItem): void {
    if (item.disabled || !item.insertText) {
        return;
    }
    const nextRange = expandSuggestionRange(editor, range, item.trailingSpace !== false);
    const text = `${item.insertText}${item.trailingSpace === false ? "" : " "}`;
    editor.chain().focus().insertContentAt(nextRange, text).run();
}

function normalizeReferenceMenuValue(item: AgentTriggerMenuItem): {
    label: string;
    target: string;
    entryType?: string | null;
    icon?: string | null;
} | null {
    if (item.workspaceReference) {
        return {
            label: item.workspaceReference.label,
            target: item.workspaceReference.target,
            entryType: item.workspaceReference.entryType ?? null,
            icon: item.workspaceReference.icon ?? null,
        };
    }
    if (!item.reference) {
        return null;
    }
    return {
        label: item.reference.title,
        target: `${item.reference.kind}://${item.reference.targetId}`,
        entryType: item.reference.kind,
        icon: null,
    };
}

function degradeAdjacentReference(position: number, direction: -1 | 1, editor: Editor): boolean {
    const resolved = editor.state.doc.resolve(position);
    const adjacentNode = direction < 0 ? resolved.nodeBefore : resolved.nodeAfter;
    if (!adjacentNode || (adjacentNode.type?.name !== "plainReference" && adjacentNode.type?.name !== "plainSelectionReference")) {
        return false;
    }

    const degradedText = adjacentNode.type.name === "plainSelectionReference"
        ? String(adjacentNode.attrs?.ref ?? "")
        : `[${String(adjacentNode.attrs?.label ?? "")}](${String(adjacentNode.attrs?.target ?? "")})`;
    const from = direction < 0 ? position - adjacentNode.nodeSize : position;
    const to = direction < 0 ? position : position + adjacentNode.nodeSize;

    editor.chain().focus().insertContentAt({from, to}, degradedText).run();
    editor.commands.setTextSelection(direction < 0 ? from + degradedText.length : from);
    return true;
}

function createReferenceElement(options: {
    label: string;
    target: string;
    entryType: string | null;
    icon: string | null;
    wrapperClass?: string;
    dataset?: Record<string, string>;
}): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = options.wrapperClass ?? "nb-plain-reference-node";
    wrapper.contentEditable = "false";
    if (!options.wrapperClass) {
        wrapper.dataset.plainReferenceLabel = options.label;
        wrapper.dataset.plainReferenceTarget = options.target;
        wrapper.dataset.plainReferenceEntryType = options.entryType ?? "";
        wrapper.dataset.plainReferenceIcon = options.icon ?? "";
    }
    Object.entries(options.dataset ?? {}).forEach(([key, value]) => {
        wrapper.dataset[key] = value;
    });

    const meta = getReferenceChipMeta({
        target: options.target,
        entryType: options.entryType,
        icon: options.icon,
    });
    const chip = document.createElement("span");
    chip.className = `nb-reference-chip ${meta.toneClass}`;
    chip.dataset.referenceTarget = options.target;
    chip.dataset.referenceEntryType = options.entryType ?? "";
    chip.title = options.target;

    const icon = document.createElement("span");
    icon.className = `nb-reference-chip__icon ${meta.iconClass}`;
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "nb-reference-chip__label";
    label.textContent = options.label;

    const badge = document.createElement("span");
    badge.className = "nb-reference-chip__badge";
    badge.textContent = meta.badgeLabel;

    chip.append(icon, label, badge);
    wrapper.append(chip);
    return wrapper;
}

function createImageChipElement(options: {label: string; target: string}): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "nb-plain-image-node";
    wrapper.dataset.plainImageLabel = options.label;
    wrapper.dataset.plainImageTarget = options.target;
    wrapper.contentEditable = "false";
    wrapper.title = options.target;

    const icon = document.createElement("span");
    icon.className = "i-lucide-image h-3 w-3";
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "nb-plain-image-node__label";
    label.textContent = options.label;
    const badge = document.createElement("span");
    badge.className = "nb-plain-image-node__badge";
    badge.textContent = "图片";
    wrapper.append(icon, label, badge);
    return wrapper;
}
