<script setup lang="ts">
/** 已发送文字的静态显示（同名 .md；docs/specs/ui/prompt-editor.md 输出 14）：与 PromptEditor 同一套文字写法，不建编辑器。 */
import {computed, ref, watch} from "vue";

import InlineChip from "../chip/InlineChip.vue";
import {LARGE_STICKER_CLASS, STICKER_GAP_END, STICKER_GAP_START} from "../language/syntax/sticker";
import "../stickers.css";
import {useMarkdownHost} from "../host";
import {provideMarkdownText} from "../host/text";
import type {MarkdownLocale} from "../locale";

import type {PromptAttachmentCard, PromptEditorToken} from "./prompt-editor.types";
import {
    largeStickerLines,
    numberKey,
    parsePromptText,
    PROMPT_PASTE_BLOCK_NODE,
    PROMPT_STICKER_NODE,
    PROMPT_TOKEN_NODE,
    promptTokenFromAttrs,
    type PromptNodeJSON,
    type PromptPasteBlockAttrs,
    type PromptTokenAttrs,
} from "./prompt-text";
import PromptAttachmentStrip from "./PromptAttachmentStrip.vue";
import PromptPasteFrame from "./PromptPasteFrame.vue";
import PromptSticker from "./PromptSticker.vue";

const host = useMarkdownHost();
const props = withDefaults(defineProps<{
    text: string;
    /** 只在上面没有注入翻译端口时起作用（`../host/text.ts`）。 */
    locale?: MarkdownLocale;
    commands?: readonly string[];
    resolveThumbnail?: (target: string) => string | null;
}>(), {
    locale: undefined,
    commands: () => [],
    resolveThumbnail: () => null,
});

const emit = defineEmits<{
    (e: "token-activate", token: PromptEditorToken): void;
}>();

// 附件条、粘贴块与小块经 inject 拿到同一个端口。
provideMarkdownText(() => props.locale);

type TokenPiece = {kind: "token"; attrs: PromptTokenAttrs; hoverKey: string | null};
type Piece = {kind: "text"; text: string} | TokenPiece | {kind: "sticker"; raw: string; gap: string};
type Block =
    | {kind: "line"; pieces: Piece[]; large: boolean}
    | {kind: "paste"; attrs: PromptPasteBlockAttrs; hoverKey: string};

function linkKey(attrs: PromptTokenAttrs): string | null {
    return attrs.kind === "image" || attrs.kind === "file" || attrs.kind === "paste" ? numberKey(attrs.kind, attrs.number ?? 0) : null;
}

function toPiece(node: PromptNodeJSON): Piece | null {
    if (node.type === "text") {
        return {kind: "text", text: node.text ?? ""};
    }
    if (node.type === PROMPT_TOKEN_NODE) {
        const attrs = node.attrs as unknown as PromptTokenAttrs;
        return {kind: "token", attrs, hoverKey: linkKey(attrs)};
    }
    if (node.type === PROMPT_STICKER_NODE) {
        return {kind: "sticker", raw: String(node.attrs?.raw ?? ""), gap: ""};
    }
    return null;
}

/** 表情紧挨文字（不是空白）的一侧留间隙，同 Markdown 的 `stickerGapClasses`。 */
function withGaps(pieces: Piece[]): Piece[] {
    return pieces.map((piece, index) => {
        if (piece.kind !== "sticker") return piece;
        const before = pieces[index - 1];
        const after = pieces[index + 1];
        const gap = [before?.kind === "text" && /\S$/u.test(before.text) ? STICKER_GAP_START : "", after?.kind === "text" && /^\S/u.test(after.text) ? STICKER_GAP_END : ""];
        return {...piece, gap: gap.filter((name) => name !== "").join(" ")};
    });
}

// 宿主的 `stickerKnown` 背后是响应式状态：目录晚到时这里重算，认得出的写法换成表情（docs/specs/agent/stickers.md 输出 44）。
const blocks = computed<Block[]>(() => {
    const known = host.stickerKnown;
    const doc = parsePromptText(props.text, known === undefined ? {commands: props.commands} : {commands: props.commands, stickerKnown: known});
    const large = largeStickerLines(doc);
    return (doc.content ?? []).map((node, index) => {
        if (node.type === PROMPT_PASTE_BLOCK_NODE) {
            const attrs = node.attrs as unknown as PromptPasteBlockAttrs;
            return {kind: "paste", attrs, hoverKey: numberKey("paste", attrs.number)};
        }
        return {kind: "line", pieces: withGaps((node.content ?? []).flatMap((child) => toPiece(child) ?? [])), large: large.has(index)};
    });
});

/** 图片与文件标签，按出现顺序；卡片 id 是它在这个列表里的下标。 */
const attachmentTokens = computed(() => blocks.value.flatMap((block) => block.kind === "line"
    ? block.pieces.filter((piece): piece is TokenPiece => piece.kind === "token" && (piece.attrs.kind === "image" || piece.attrs.kind === "file"))
    : []));

const cards = computed<PromptAttachmentCard[]>(() => attachmentTokens.value.map((piece, index) => {
    const kind = piece.attrs.kind === "image" ? "image" : "file";
    return {
        id: String(index),
        hoverKey: piece.hoverKey ?? "",
        kind,
        number: piece.attrs.number ?? 0,
        name: piece.attrs.label,
        state: "ready",
        thumbnail: kind === "image" && piece.attrs.target !== "" ? props.resolveThumbnail(piece.attrs.target) : null,
    };
}));

const highlighted = ref<string | null>(null);
/** 展开的粘贴块，按块的下标记；换了文字后全部收起。 */
const expanded = ref(new Set<number>());

watch(() => props.text, () => {
    expanded.value = new Set();
    highlighted.value = null;
});

function setExpanded(index: number, value: boolean): void {
    const next = new Set(expanded.value);
    if (value) {
        next.add(index);
    }
    else {
        next.delete(index);
    }
    expanded.value = next;
}

function hover(key: string | null, active: boolean): void {
    if (key !== null) {
        highlighted.value = active ? key : null;
    }
}

function activateCard(id: string): void {
    const piece = attachmentTokens.value[Number(id)];
    if (piece) {
        emit("token-activate", promptTokenFromAttrs(piece.attrs));
    }
}
</script>

<template>
    <div class="prompt-text">
        <PromptAttachmentStrip
            :cards="cards"
            :highlighted="highlighted"
            readonly
            class="prompt-text__strip"
            @activate="activateCard"
            @hover="highlighted = $event"
        />
        <template v-for="(block, index) in blocks" :key="index">
            <PromptPasteFrame
                v-if="block.kind === 'paste'"
                :number="block.attrs.number"
                :content="block.attrs.content"
                :expanded="expanded.has(index)"
                :highlighted="highlighted === block.hoverKey"
                :data-prompt-paste="block.attrs.number"
                @update:expanded="setExpanded(index, $event)"
                @hover="hover(block.hoverKey, $event)"
            />
            <div v-else class="prompt-text__line" :class="{[LARGE_STICKER_CLASS]: block.large}">
                <template v-for="(piece, pieceIndex) in block.pieces" :key="pieceIndex">
                    <template v-if="piece.kind === 'text'">{{ piece.text }}</template>
                    <PromptSticker v-else-if="piece.kind === 'sticker'" :raw="piece.raw" :gap="piece.gap" />
                    <InlineChip
                        :env="host.chips"
                        v-else
                        :kind="piece.attrs.kind"
                        :label="piece.attrs.label"
                        :target="piece.attrs.target"
                        :number="piece.attrs.number"
                        :highlighted="piece.hoverKey !== null && highlighted === piece.hoverKey"
                        interactive
                        @activate="emit('token-activate', promptTokenFromAttrs(piece.attrs))"
                        @hover="hover(piece.hoverKey, $event)"
                    />
                </template>
                <br v-if="block.pieces.length === 0">
            </div>
        </template>
    </div>
</template>

<style scoped>
.prompt-text {
    min-width: 0;
    overflow-wrap: anywhere;
}

.prompt-text__strip {
    margin-bottom: 0.4rem;
}

.prompt-text__line {
    white-space: pre-wrap;
}
</style>
