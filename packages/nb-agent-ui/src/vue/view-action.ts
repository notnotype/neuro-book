/**
 * 视图内部流通的 action：宿主的 action，加上只在视图里处理的原图预览。内部组件只发这一种事件，`AgentConversationView`
 * 在一处分派：预览自己打开，其余交给宿主。预览是纯界面行为（docs/specs/ui/agent-conversation-view.md“消息”），
 * 不进公开的 `AgentViewAction`，宿主收不到。
 */
import type {PromptToken, StickerPreviewRequest} from "../ports";
import type {AgentViewAction} from "../types";
import {promptTokenOutcome} from "../prompt-token-action";

/**
 * 原图预览的请求。附件按 `locator` 经 `services.resolveAttachmentUrl` 取原图；回复 Markdown 里的图片按地址经
 * `services.resolveMarkdownAsset` 取；表情的图已经是能显示的地址（`url`），另带复制的写法与放大到的尺寸。
 */
export type PreviewImageRequest =
    | {locator: string; name: string}
    | {markdownSrc: string; name: string}
    | {url: string; name: string; copyText: string; minSize: number};

/** 表情预览里长边不到它的图放大到它（docs/specs/agent/stickers.md 输出 46）。 */
export const STICKER_PREVIEW_MIN_SIZE = 320;

/**
 * 点开表情的大图：回复与用户消息共用。标题是“名字 · 包的显示名”（`withPack` 按语言拼），没有包名时只写名字。
 */
export function stickerPreviewAction(sticker: StickerPreviewRequest, withPack: (name: string, pack: string) => string): ViewAction {
    const title = sticker.packTitle === undefined ? sticker.name : withPack(sticker.name, sticker.packTitle);
    return {type: "image.preview", image: {url: sticker.url, name: title, copyText: sticker.raw, minSize: STICKER_PREVIEW_MIN_SIZE}};
}

export type ViewAction = AgentViewAction | {type: "image.preview"; image: PreviewImageRequest};

/** 点击输入框或已发送消息里的标签：输入框与消息显示共用，两边的结果才一致。没有可做的事时为 null。 */
export function tokenAction(token: PromptToken, imageLabel: (number: number) => string): ViewAction | null {
    const outcome = promptTokenOutcome(token, imageLabel);
    if (outcome === null) return null;
    return outcome.kind === "action" ? outcome.action : {type: "image.preview", image: outcome.image};
}
