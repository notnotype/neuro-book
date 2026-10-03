import {describe, expect, it} from "vitest";
import {
    PREVIOUS_HISTORY_SCROLL_THRESHOLD_PX,
    canEditHistoryMessage,
    prependAnchoredScrollTop,
    shouldAutoScrollChat,
    shouldLoadPreviousHistory,
    shouldLoadSystemPrompt,
} from "nbook/app/components/novel-ide/agent/agent-chat-history-ui";

describe("agent chat history ui", () => {
    it("只在接近顶部且仍有前页时触发历史查询", () => {
        expect(shouldLoadPreviousHistory({
            scrollTop: PREVIOUS_HISTORY_SCROLL_THRESHOLD_PX,
            hasPrevious: true,
            loading: false,
        })).toBe(true);
        expect(shouldLoadPreviousHistory({
            scrollTop: PREVIOUS_HISTORY_SCROLL_THRESHOLD_PX + 1,
            hasPrevious: true,
            loading: false,
        })).toBe(false);
        expect(shouldLoadPreviousHistory({
            scrollTop: 0,
            hasPrevious: false,
            loading: false,
        })).toBe(false);
        expect(shouldLoadPreviousHistory({
            scrollTop: 0,
            hasPrevious: true,
            loading: true,
        })).toBe(false);
    });

    it("prepend 后按新增内容高度恢复原有视口", () => {
        expect(prependAnchoredScrollTop({
            previousScrollTop: 96,
            previousScrollHeight: 1_200,
            nextScrollHeight: 1_860,
        })).toBe(756);
    });

    it("System Prompt 只在显式打开且当前 session 尚未加载时请求", () => {
        expect(shouldLoadSystemPrompt({open: true, loading: false, hasValue: false})).toBe(true);
        expect(shouldLoadSystemPrompt({open: false, loading: false, hasValue: false})).toBe(false);
        expect(shouldLoadSystemPrompt({open: true, loading: true, hasValue: false})).toBe(false);
        expect(shouldLoadSystemPrompt({open: true, loading: false, hasValue: true})).toBe(false);
    });

    it("短列表 prepend transaction 不被自动吸底覆盖", () => {
        expect(shouldAutoScrollChat({stickToBottom: true, prependPending: true})).toBe(false);
        expect(shouldAutoScrollChat({stickToBottom: true, prependPending: false})).toBe(true);
    });

    it("正文只有有界预览时禁止进入可保存编辑态", () => {
        expect(canEditHistoryMessage({type: "user", contentOmitted: false})).toBe(true);
        expect(canEditHistoryMessage({type: "ai", contentOmitted: true})).toBe(false);
        expect(canEditHistoryMessage({type: "system", contentOmitted: false})).toBe(false);
    });
});
