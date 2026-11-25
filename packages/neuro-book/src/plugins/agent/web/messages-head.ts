/**
 * 消息视图浮成窗口时自绘的头那一条有多高（docs/specs/workbench/views.md 输出 19 的“自绘头”，docs/specs/agent/conversation.md 消息视图）：
 * 实现上声明的 `VIEW_OWN_HEAD` 的 `band`（`plugin.ts`）与宿主给 nb-agent-ui 的 `--acv-head-height`（`MessagesHost.vue`）都用它，
 * 也等于列表切换行缺省的高度。
 */
export const MESSAGES_HEAD_BAND = 40;
