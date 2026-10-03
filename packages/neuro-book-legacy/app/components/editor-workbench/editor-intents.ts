/**
 * 编辑工作台的**领域意图载荷**：组件只描述"用户想做什么"，不读全局拖动状态推断操作。
 *
 * 同一文档可以在不同组各有实例；来源、目标与模式必须显式给出，宿主据此原子执行。
 */
import type {EditorSplitDirection, EditorTabDropPosition} from "./editor-view.types";

/**
 * 分屏意图：
 * - 工具栏"向右分屏"：`sourceGroupId === targetGroupId` 且 `mode: 'copy'`（同一正文的第二视图）；
 * - 拖到组边缘：`mode: 'move'`，标签搬到目标组旁的新组，源组因此为空时塌陷。
 */
export type EditorSplitPayload = Readonly<{
    sourceGroupId: string;
    targetGroupId: string;
    path: string;
    direction: EditorSplitDirection;
    mode: "copy" | "move";
}>;

/** 标签栏跨组移动；包含完整来源与目标，不依赖拖动中的全局状态。 */
export interface TabTransferPayload {
    path: string;
    sourceGroupId: string;
    targetGroupId: string;
    targetPath: string | null;
    targetPinned: boolean;
    position: EditorTabDropPosition;
}
