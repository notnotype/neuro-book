<script setup lang="ts">
import type {Editor} from "@tiptap/core";
import {BubbleMenu} from "@tiptap/vue-3/menus";
import type {EditorState} from "@tiptap/pm/state";
import type {EditorView} from "@tiptap/pm/view";
import {IDE_THEME_HOST_CLASS} from "nbook/app/utils/theme/theme-tokens";
import {useDialog} from "nbook/app/composables/useDialog";

type TextBlockCommand = "paragraph" | "heading-1" | "heading-2" | "heading-3" | "bullet-list" | "ordered-list" | "blockquote" | "code-block";
type ColorKind = "text" | "highlight";

interface TextBlockOption {
    id: TextBlockCommand;
    label: string;
    iconClass: string;
}

interface ColorOption {
    id: string;
    label: string;
    value: string;
}

const props = defineProps<{
    editor: Editor;
    readonly?: boolean;
}>();

const emit = defineEmits<{
    (e: "insert-reference"): void;
    (e: "insert-image"): void;
    (e: "add-comment"): void;
    (e: "add-ruby"): void;
    (e: "add-bilingual"): void;
    (e: "add-ai-reference"): void;
    (e: "generate-illustration"): void;
}>();

const {prompt} = useDialog();
const {t} = useI18n();
const textMenuOpen = ref(false);
const colorMenuOpen = ref(false);
const moreMenuOpen = ref(false);
const bubbleMenuVisible = ref(true);
const revision = ref(0);

const textBlockOptions = computed<TextBlockOption[]>(() => [
    {id: "paragraph", label: t("markdownStudio.selection.paragraph"), iconClass: "i-lucide-type"},
    {id: "heading-1", label: t("markdownStudio.selection.heading1"), iconClass: "i-lucide-heading-1"},
    {id: "heading-2", label: t("markdownStudio.selection.heading2"), iconClass: "i-lucide-heading-2"},
    {id: "heading-3", label: t("markdownStudio.selection.heading3"), iconClass: "i-lucide-heading-3"},
    {id: "bullet-list", label: t("markdownStudio.selection.bulletList"), iconClass: "i-lucide-list"},
    {id: "ordered-list", label: t("markdownStudio.selection.orderedList"), iconClass: "i-lucide-list-ordered"},
    {id: "blockquote", label: t("markdownStudio.selection.blockquote"), iconClass: "i-lucide-quote"},
    {id: "code-block", label: t("markdownStudio.selection.codeBlock"), iconClass: "i-lucide-square-code"},
]);

const textColors = computed<ColorOption[]>(() => [
    {id: "default", label: t("markdownStudio.selection.defaultColor"), value: ""},
    {id: "slate", label: t("markdownStudio.selection.slate"), value: "#64748b"},
    {id: "orange", label: t("markdownStudio.selection.orange"), value: "#f97316"},
    {id: "amber", label: t("markdownStudio.selection.amber"), value: "#f59e0b"},
    {id: "yellow", label: t("markdownStudio.selection.yellow"), value: "#eab308"},
    {id: "emerald", label: t("markdownStudio.selection.emerald"), value: "#10b981"},
    {id: "sky", label: t("markdownStudio.selection.sky"), value: "#0ea5e9"},
    {id: "violet", label: t("markdownStudio.selection.violet"), value: "#8b5cf6"},
    {id: "pink", label: t("markdownStudio.selection.pink"), value: "#ec4899"},
    {id: "red", label: t("markdownStudio.selection.red"), value: "#ef4444"},
]);

const highlightColors = computed<ColorOption[]>(() => [
    {id: "none", label: t("markdownStudio.selection.noneColor"), value: ""},
    {id: "neutral", label: t("markdownStudio.selection.neutral"), value: "#f1f5f9"},
    {id: "stone", label: t("markdownStudio.selection.stone"), value: "#ede9e1"},
    {id: "orange", label: t("markdownStudio.selection.orange"), value: "#ffedd5"},
    {id: "yellow", label: t("markdownStudio.selection.yellow"), value: "#fef9c3"},
    {id: "green", label: t("markdownStudio.selection.green"), value: "#dcfce7"},
    {id: "blue", label: t("markdownStudio.selection.blue"), value: "#dbeafe"},
    {id: "purple", label: t("markdownStudio.selection.purple"), value: "#ede9fe"},
    {id: "pink", label: t("markdownStudio.selection.pink"), value: "#fce7f3"},
    {id: "red", label: t("markdownStudio.selection.red"), value: "#fee2e2"},
]);

const bubbleOptions = {
    strategy: "fixed" as const,
    placement: "top" as const,
    offset: 10,
    shift: {
        padding: 10,
    },
    flip: {
        padding: 10,
    },
    inline: true,
};

const currentTextOption = computed<TextBlockOption>(() => {
    void revision.value;
    if (props.editor.isActive("heading", {level: 1})) {
        return textBlockOptions.value.find((option) => option.id === "heading-1") ?? textBlockOptions.value[0]!;
    }
    if (props.editor.isActive("heading", {level: 2})) {
        return textBlockOptions.value.find((option) => option.id === "heading-2") ?? textBlockOptions.value[0]!;
    }
    if (props.editor.isActive("heading", {level: 3})) {
        return textBlockOptions.value.find((option) => option.id === "heading-3") ?? textBlockOptions.value[0]!;
    }
    if (props.editor.isActive("bulletList")) {
        return textBlockOptions.value.find((option) => option.id === "bullet-list") ?? textBlockOptions.value[0]!;
    }
    if (props.editor.isActive("orderedList")) {
        return textBlockOptions.value.find((option) => option.id === "ordered-list") ?? textBlockOptions.value[0]!;
    }
    if (props.editor.isActive("blockquote")) {
        return textBlockOptions.value.find((option) => option.id === "blockquote") ?? textBlockOptions.value[0]!;
    }
    if (props.editor.isActive("codeBlock")) {
        return textBlockOptions.value.find((option) => option.id === "code-block") ?? textBlockOptions.value[0]!;
    }
    return textBlockOptions.value[0]!;
});

const currentTextColor = computed(() => {
    void revision.value;
    return String(props.editor.getAttributes("markdownTextColor").color ?? "");
});

const currentHighlightColor = computed(() => {
    void revision.value;
    return String(props.editor.getAttributes("markdownHighlight").color ?? "");
});

const canIndentList = computed(() => {
    void revision.value;
    return props.editor.can().sinkListItem("listItem");
});

const canOutdentList = computed(() => {
    void revision.value;
    return props.editor.can().liftListItem("listItem");
});

function appendToThemeHost(): HTMLElement {
    return document.querySelector<HTMLElement>(`.${IDE_THEME_HOST_CLASS}`) ?? document.body;
}

function shouldShowMenu(options: {
    editor: Editor;
    view: EditorView;
    state: EditorState;
    from: number;
    to: number;
}): boolean {
    if (!bubbleMenuVisible.value) {
        closeDropdowns();
        return false;
    }
    if (props.readonly || !options.editor.isEditable || !options.editor.isFocused) {
        closeDropdowns();
        return false;
    }
    if (options.from === options.to || options.state.selection.empty) {
        closeDropdowns();
        return false;
    }
    return Boolean(options.view.dom.closest(".tiptap-markdown-wrapper"));
}

function closeDropdowns(): void {
    textMenuOpen.value = false;
    colorMenuOpen.value = false;
    moreMenuOpen.value = false;
}

function hideBubbleMenu(): void {
    closeDropdowns();
    bubbleMenuVisible.value = false;
}

function showBubbleMenu(): void {
    bubbleMenuVisible.value = true;
}

function toggleDropdown(menu: "text" | "color" | "more"): void {
    textMenuOpen.value = menu === "text" ? !textMenuOpen.value : false;
    colorMenuOpen.value = menu === "color" ? !colorMenuOpen.value : false;
    moreMenuOpen.value = menu === "more" ? !moreMenuOpen.value : false;
}

function runCommand(command: () => void, closeMenu = true): void {
    if (props.readonly) {
        return;
    }
    if (closeMenu) {
        closeDropdowns();
    }
    command();
    revision.value += 1;
}

function applyTextBlock(command: TextBlockCommand): void {
    runCommand(() => {
        const chain = props.editor.chain().focus();
        if (command === "paragraph") {
            chain.setParagraph().run();
            return;
        }
        if (command === "heading-1" || command === "heading-2" || command === "heading-3") {
            chain.toggleHeading({level: Number(command.slice(-1)) as 1 | 2 | 3}).run();
            return;
        }
        if (command === "bullet-list") {
            chain.toggleBulletList().run();
            return;
        }
        if (command === "ordered-list") {
            chain.toggleOrderedList().run();
            return;
        }
        if (command === "blockquote") {
            chain.toggleBlockquote().run();
            return;
        }
        chain.toggleCodeBlock().run();
    });
}

async function setLink(): Promise<void> {
    if (props.readonly) {
        return;
    }
    closeDropdowns();
    const previousHref = String(props.editor.getAttributes("link").href ?? "");
    const href = await prompt(t("markdownStudio.selection.editLinkPrompt"), previousHref || "https://", t("markdownStudio.selection.editLinkTitle"));
    if (href === null) {
        return;
    }
    const trimmed = href.trim();
    if (!trimmed) {
        props.editor.chain().focus().extendMarkRange("link").unsetLink().run();
        return;
    }
    props.editor.chain().focus().extendMarkRange("link").setLink({href: trimmed}).run();
}

function applyColor(kind: ColorKind, color: string): void {
    runCommand(() => {
        const chain = props.editor.chain().focus();
        if (kind === "text") {
            if (color) {
                chain.setMarkdownTextColor(color).run();
            } else {
                chain.unsetMarkdownTextColor().run();
            }
            return;
        }
        if (color) {
            chain.setMarkdownHighlight(color).run();
        } else {
            chain.unsetMarkdownHighlight().run();
        }
    }, false);
}

function applyAlign(align: "left" | "center" | "right" | "justify"): void {
    runCommand(() => {
        props.editor.chain().focus().setMarkdownAlign(align).run();
    }, false);
}

function isActive(name: string, attributes?: Record<string, unknown>): boolean {
    void revision.value;
    return props.editor.isActive(name, attributes);
}

function bumpRevision(): void {
    revision.value += 1;
}

onMounted(() => {
    props.editor.on("focus", showBubbleMenu);
    props.editor.on("blur", hideBubbleMenu);
    props.editor.on("selectionUpdate", bumpRevision);
    props.editor.on("transaction", bumpRevision);
});

onUnmounted(() => {
    props.editor.off("focus", showBubbleMenu);
    props.editor.off("blur", hideBubbleMenu);
    props.editor.off("selectionUpdate", bumpRevision);
    props.editor.off("transaction", bumpRevision);
});
</script>

<template>
    <BubbleMenu
        class="markdown-selection-menu-layer"
        :class="bubbleMenuVisible ? '' : 'is-hidden'"
        :editor="props.editor"
        plugin-key="markdown-selection-menu"
        :append-to="appendToThemeHost"
        :should-show="shouldShowMenu"
        :options="bubbleOptions"
        :update-delay="80"
        :resize-delay="80"
    >
        <div class="markdown-selection-menu" @mousedown.prevent>
            <button
                type="button"
                class="markdown-selection-menu__button markdown-selection-menu__button--improve"
                :title="t('markdownStudio.selection.addAiReference')"
                @click="closeDropdowns(); emit('add-ai-reference')"
            >
                <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
                <span>{{ t("markdownStudio.selection.addAiReference") }}</span>
            </button>

            <!-- 引用生图：选中文字 → ComfyUI 生成插画 -->
            <button
                type="button"
                class="markdown-selection-menu__button"
                :title="t('markdownStudio.selection.generateIllustration')"
                @click="closeDropdowns(); emit('generate-illustration')"
            >
                <span class="i-lucide-image-plus h-3.5 w-3.5"></span>
                <span>{{ t("markdownStudio.selection.generateIllustration") }}</span>
            </button>

            <div class="markdown-selection-menu__divider"></div>

            <div class="markdown-selection-menu__group">
                <button
                    type="button"
                    class="markdown-selection-menu__button markdown-selection-menu__button--text"
                    :title="t('markdownStudio.selection.textStyle')"
                    @click="toggleDropdown('text')"
                >
                    <span :class="currentTextOption.iconClass" class="h-3.5 w-3.5"></span>
                    <span class="i-lucide-chevron-down h-3 w-3"></span>
                </button>
                <div v-if="textMenuOpen" class="markdown-selection-menu__dropdown markdown-selection-menu__dropdown--text">
                    <button
                        v-for="option in textBlockOptions"
                        :key="option.id"
                        type="button"
                        class="markdown-selection-menu__dropdown-item"
                        :class="currentTextOption.id === option.id ? 'is-active' : ''"
                        @click="applyTextBlock(option.id)"
                    >
                        <span :class="option.iconClass" class="h-3.5 w-3.5"></span>
                        <span>{{ option.label }}</span>
                    </button>
                </div>
            </div>

            <div class="markdown-selection-menu__divider"></div>

            <button
                type="button"
                class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                :class="isActive('bold') ? 'is-active' : ''"
                :title="t('markdownStudio.selection.bold')"
                @click="runCommand(() => props.editor.chain().focus().toggleBold().run())"
            >
                <span class="i-lucide-bold h-3.5 w-3.5"></span>
            </button>
            <button
                type="button"
                class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                :class="isActive('italic') ? 'is-active' : ''"
                :title="t('markdownStudio.selection.italic')"
                @click="runCommand(() => props.editor.chain().focus().toggleItalic().run())"
            >
                <span class="i-lucide-italic h-3.5 w-3.5"></span>
            </button>
            <button
                type="button"
                class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                :class="isActive('underline') ? 'is-active' : ''"
                :title="t('markdownStudio.selection.underline')"
                @click="runCommand(() => props.editor.chain().focus().toggleUnderline().run())"
            >
                <span class="i-lucide-underline h-3.5 w-3.5"></span>
            </button>
            <button
                type="button"
                class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                :class="isActive('strike') ? 'is-active' : ''"
                :title="t('markdownStudio.selection.strike')"
                @click="runCommand(() => props.editor.chain().focus().toggleStrike().run())"
            >
                <span class="i-lucide-strikethrough h-3.5 w-3.5"></span>
            </button>
            <button
                type="button"
                class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                :class="isActive('code') ? 'is-active' : ''"
                :title="t('markdownStudio.selection.code')"
                @click="runCommand(() => props.editor.chain().focus().toggleCode().run())"
            >
                <span class="i-lucide-code h-3.5 w-3.5"></span>
            </button>
            <button
                type="button"
                class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                :title="t('markdownStudio.selection.clearFormatting')"
                @click="runCommand(() => props.editor.chain().focus().unsetAllMarks().clearNodes().run())"
            >
                <span class="i-lucide-eraser h-3.5 w-3.5"></span>
            </button>

            <div class="markdown-selection-menu__divider"></div>

            <button type="button" class="markdown-selection-menu__button markdown-selection-menu__button--icon" :title="t('markdownStudio.selection.link')" @click="void setLink()">
                <span class="i-lucide-link h-3.5 w-3.5"></span>
            </button>
            <button type="button" class="markdown-selection-menu__button markdown-selection-menu__button--icon" :title="t('markdownStudio.selection.addComment')" @click="closeDropdowns(); emit('add-comment')">
                <span class="i-lucide-message-square-plus h-3.5 w-3.5"></span>
            </button>
            <button type="button" class="markdown-selection-menu__button markdown-selection-menu__button--icon" :title="t('markdownStudio.selection.image')" @click="closeDropdowns(); emit('insert-image')">
                <span class="i-lucide-image h-3.5 w-3.5"></span>
            </button>

            <div class="markdown-selection-menu__group">
                <button
                    type="button"
                    class="markdown-selection-menu__button markdown-selection-menu__button--color"
                    :class="currentTextColor || currentHighlightColor ? 'is-active' : ''"
                    :title="t('markdownStudio.selection.colorAndHighlight')"
                    @click="toggleDropdown('color')"
                >
                    <span class="markdown-selection-menu__letter-a" :style="{color: currentTextColor || undefined, backgroundColor: currentHighlightColor || undefined}">A</span>
                    <span class="i-lucide-chevron-down h-2.5 w-2.5"></span>
                </button>
                <div v-if="colorMenuOpen" class="markdown-selection-menu__dropdown markdown-selection-menu__dropdown--color">
                    <div class="markdown-selection-menu__palette-title">{{ t("markdownStudio.selection.textColor") }}</div>
                    <div class="markdown-selection-menu__palette-grid">
                        <button
                            v-for="color in textColors"
                            :key="color.id"
                            type="button"
                            class="markdown-selection-menu__color-swatch"
                            :class="currentTextColor === color.value ? 'is-active' : ''"
                            :title="color.label"
                            @click="applyColor('text', color.value)"
                        >
                            <span class="markdown-selection-menu__swatch-letter" :style="{color: color.value || 'var(--text-secondary)'}">A</span>
                        </button>
                    </div>

                    <div class="markdown-selection-menu__palette-title">{{ t("markdownStudio.selection.highlightColor") }}</div>
                    <div class="markdown-selection-menu__palette-grid">
                        <button
                            v-for="color in highlightColors"
                            :key="color.id"
                            type="button"
                            class="markdown-selection-menu__color-swatch"
                            :class="currentHighlightColor === color.value ? 'is-active' : ''"
                            :title="color.label"
                            @click="applyColor('highlight', color.value)"
                        >
                            <span class="markdown-selection-menu__swatch-dot" :style="{backgroundColor: color.value || 'transparent'}"></span>
                        </button>
                    </div>
                </div>
            </div>

            <div class="markdown-selection-menu__divider"></div>

            <div class="markdown-selection-menu__group">
                <button type="button" class="markdown-selection-menu__button markdown-selection-menu__button--icon" :title="t('markdownStudio.selection.moreFormatting')" @click="toggleDropdown('more')">
                    <span class="i-lucide-ellipsis-vertical h-3.5 w-3.5"></span>
                </button>
                <div v-if="moreMenuOpen" class="markdown-selection-menu__dropdown markdown-selection-menu__dropdown--more">
                    <button
                        type="button"
                        class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                        :class="isActive('markdownSuperscript') ? 'is-active' : ''"
                        :title="t('markdownStudio.selection.superscript')"
                        @click="runCommand(() => props.editor.chain().focus().toggleMarkdownSuperscript().run(), false)"
                    >
                        <span class="i-lucide-superscript h-3.5 w-3.5"></span>
                    </button>
                    <button
                        type="button"
                        class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                        :class="isActive('markdownSubscript') ? 'is-active' : ''"
                        :title="t('markdownStudio.selection.subscript')"
                        @click="runCommand(() => props.editor.chain().focus().toggleMarkdownSubscript().run(), false)"
                    >
                        <span class="i-lucide-subscript h-3.5 w-3.5"></span>
                    </button>
                    <button
                        type="button"
                        class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                        :class="isActive('markdownRuby') ? 'is-active' : ''"
                        :title="t('markdownStudio.selection.addRuby')"
                        @click="closeDropdowns(); emit('add-ruby')"
                    >
                        <span class="i-lucide-languages h-3.5 w-3.5"></span>
                    </button>
                    <button
                        type="button"
                        class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                        :class="isActive('markdownBilingual') ? 'is-active' : ''"
                        :title="t('markdownStudio.selection.addBilingual')"
                        @click="closeDropdowns(); emit('add-bilingual')"
                    >
                        <span class="i-lucide-letter-text h-3.5 w-3.5"></span>
                    </button>
                    <div class="markdown-selection-menu__divider"></div>
                    <button type="button" class="markdown-selection-menu__button markdown-selection-menu__button--icon" :title="t('markdownStudio.selection.alignLeft')" @click="applyAlign('left')">
                        <span class="i-lucide-align-left h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="markdown-selection-menu__button markdown-selection-menu__button--icon" :title="t('markdownStudio.selection.alignCenter')" @click="applyAlign('center')">
                        <span class="i-lucide-align-center h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="markdown-selection-menu__button markdown-selection-menu__button--icon" :title="t('markdownStudio.selection.alignRight')" @click="applyAlign('right')">
                        <span class="i-lucide-align-right h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="markdown-selection-menu__button markdown-selection-menu__button--icon" :title="t('markdownStudio.selection.alignJustify')" @click="applyAlign('justify')">
                        <span class="i-lucide-align-justify h-3.5 w-3.5"></span>
                    </button>
                    <div class="markdown-selection-menu__divider"></div>
                    <button
                        type="button"
                        class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                        :disabled="!canOutdentList"
                        :title="t('markdownStudio.selection.decreaseIndent')"
                        @click="runCommand(() => props.editor.chain().focus().liftListItem('listItem').run(), false)"
                    >
                        <span class="i-lucide-indent-decrease h-3.5 w-3.5"></span>
                    </button>
                    <button
                        type="button"
                        class="markdown-selection-menu__button markdown-selection-menu__button--icon"
                        :disabled="!canIndentList"
                        :title="t('markdownStudio.selection.increaseIndent')"
                        @click="runCommand(() => props.editor.chain().focus().sinkListItem('listItem').run(), false)"
                    >
                        <span class="i-lucide-indent-increase h-3.5 w-3.5"></span>
                    </button>
                </div>
            </div>
        </div>
    </BubbleMenu>
</template>

<style scoped>
.markdown-selection-menu-layer {
    z-index: 8500;
    pointer-events: auto;
}

.markdown-selection-menu-layer.is-hidden {
    display: none;
}

.markdown-selection-menu {
    display: flex;
    align-items: center;
    gap: 2px;
    border: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
    border-radius: 18px;
    background: color-mix(in srgb, var(--bg-panel) 96%, var(--editor-bg));
    padding: 6px;
    color: var(--text-main);
    box-shadow: 0 18px 44px color-mix(in srgb, var(--shadow-color) 16%, transparent), 0 1px 2px color-mix(in srgb, var(--shadow-color) 14%, transparent);
}

.markdown-selection-menu__button {
    display: inline-flex;
    height: 30px;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 10px;
    padding: 0 8px;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1;
    transition: background-color 0.15s ease, color 0.15s ease;
}

.markdown-selection-menu__button:hover,
.markdown-selection-menu__button.is-active {
    background: var(--bg-hover);
    color: var(--text-main);
}

.markdown-selection-menu__button:disabled {
    cursor: default;
    opacity: 0.42;
}

.markdown-selection-menu__button:disabled:hover {
    background: transparent;
    color: var(--text-secondary);
}

.markdown-selection-menu__button--improve {
    min-width: 106px;
    justify-content: flex-start;
    padding: 0 11px;
    font-weight: 600;
}

.markdown-selection-menu__button--text {
    width: 48px;
    justify-content: center;
}

.markdown-selection-menu__button--icon {
    width: 30px;
    padding: 0;
}

.markdown-selection-menu__button--color {
    width: 42px;
    padding: 0 6px;
}

.markdown-selection-menu__text-label {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
}

.markdown-selection-menu__letter-a {
    display: inline-flex;
    flex: none;
    width: 24px;
    min-width: 24px;
    height: 24px;
    min-height: 24px;
    aspect-ratio: 1 / 1;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, currentColor 34%, var(--border-color));
    border-radius: 50%;
    background: color-mix(in srgb, var(--bg-panel) 88%, currentColor 12%);
    background-clip: padding-box;
    box-shadow: inset 0 -2px 0 color-mix(in srgb, currentColor 42%, transparent);
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
}

.markdown-selection-menu__divider {
    width: 1px;
    height: 24px;
    margin: 0 4px;
    background: color-mix(in srgb, var(--border-color) 72%, transparent);
}

.markdown-selection-menu__group {
    position: relative;
    display: inline-flex;
}

.markdown-selection-menu__dropdown {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 1;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 14px;
    background: var(--bg-panel);
    padding: 6px;
    box-shadow: 0 16px 38px color-mix(in srgb, var(--shadow-color) 18%, transparent);
}

.markdown-selection-menu__dropdown--text {
    width: 184px;
}

.markdown-selection-menu__dropdown--color {
    right: 0;
    left: auto;
    width: 206px;
    padding: 14px;
}

.markdown-selection-menu__dropdown--more {
    top: auto;
    bottom: calc(100% + 8px);
    right: 0;
    left: auto;
    display: flex;
    width: 330px;
    align-items: center;
    gap: 2px;
    padding: 6px;
}

.markdown-selection-menu__dropdown-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    border-radius: 9px;
    padding: 7px 8px;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: left;
    transition: background-color 0.15s ease, color 0.15s ease;
}

.markdown-selection-menu__dropdown-item:hover,
.markdown-selection-menu__dropdown-item.is-active {
    background: var(--bg-hover);
    color: var(--text-main);
}

.markdown-selection-menu__palette-title {
    margin-bottom: 8px;
    color: var(--text-main);
    font-size: 12px;
    font-weight: 650;
}

.markdown-selection-menu__palette-title:not(:first-child) {
    margin-top: 14px;
}

.markdown-selection-menu__palette-grid {
    display: grid;
    grid-template-columns: repeat(5, 24px);
    gap: 8px;
}

.markdown-selection-menu__color-swatch {
    display: inline-flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: transparent;
    transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.markdown-selection-menu__color-swatch:hover,
.markdown-selection-menu__color-swatch.is-active {
    border-color: var(--accent-main);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-main) 18%, transparent);
}

.markdown-selection-menu__color-swatch:hover {
    transform: translateY(-1px);
}

.markdown-selection-menu__swatch-letter {
    font-size: 13px;
    font-weight: 650;
    line-height: 1;
}

.markdown-selection-menu__swatch-dot {
    display: inline-flex;
    width: 20px;
    height: 20px;
    border-radius: 999px;
}
</style>
