<script setup lang="ts">
import type {MarkdownActivation, MarkdownAssetResolver} from "../../ports";
import {useAgentRenderers, useAgentText} from "../host";
import {stickerPreviewAction} from "../view-action";
import type {ViewAction} from "../view-action";

const props = defineProps<{
    text: string;
    /** 图片地址换算；不提供时图片只显示说明。 */
    resolveAsset?: MarkdownAssetResolver;
    streaming?: boolean;
}>();

const emit = defineEmits<{
    (e: "action", action: ViewAction): void;
}>();

const {locale, t} = useAgentText();
const renderers = useAgentRenderers();

/**
 * 颜色与字号写在注入组件的根元素上：它的根自己声明了颜色与 `--markdown-font-size`，外层继承下来的值压不过（`ports.ts`
 * 的 `MarkdownDisplayPortProps`）。值仍从所在位置的 `--nb-agent-markdown-*` 取，思考与提醒因此是淡色小字。
 */
const TONE = {color: "var(--nb-agent-markdown-color, var(--text-main))", "--markdown-font-size": "var(--nb-agent-markdown-size, var(--text-sm))"};

/** Markdown 显示组件拦下点击、只发出 activate；这里换成视图的动作（docs/specs/ui/agent-conversation-view.md“消息”）。 */
function onActivate(activation: MarkdownActivation) {
    switch (activation.kind) {
        case "reference":
            emit("action", {type: "reference.open", target: activation.target});
            return;
        case "link":
            emit("action", {type: "link.open", href: activation.href});
            return;
        case "image":
            emit("action", {type: "image.preview", image: {markdownSrc: activation.address, name: activation.address}});
            return;
        case "sticker":
            emit("action", stickerPreviewAction(activation.sticker, (name, pack) => t("stickerPreview.title", {name, pack})));
            return;
    }
}
</script>

<template>
    <div class="agent-markdown">
        <component
            :is="renderers.markdown"
            :text="props.text"
            :locale="locale"
            :streaming="props.streaming ?? false"
            :resolve-asset="props.resolveAsset"
            :style="TONE"
            @activate="onActivate"
        />
    </div>
</template>

<style scoped>
/* 所在位置用 --nb-agent-markdown-color、--nb-agent-markdown-size 调颜色与字号，例如思考与提醒用淡色小字；缺省实现靠继承。 */
.agent-markdown {
    min-width: 0;
    color: var(--nb-agent-markdown-color, var(--text-main));
    font-size: var(--nb-agent-markdown-size, var(--text-sm));
    overflow-wrap: anywhere;
}
</style>
