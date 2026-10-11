/**
 * Profile：TSX 提示词布局、节点与数据源与字段的注册、渲染。行为合同见 docs/specs/harness/profile.md。
 * JSX 运行时在子入口 `profile/jsx-runtime`、`profile/jsx-dev-runtime`；加载 Profile 文件在 `profile/loader`。
 */

export type {
    AppendedMessage, AppendingOutput, Diagnostic, FieldDefinition, JsonValue, NodeTypeDefinition, PreparedProfile, Profile, ProfileCatalog,
    ProfileChild, ProfileDefinition, ProfileFailure, ProfileHost, ProfileIssue, ProfileNode, ProfileResult, ProfileState, PromptContext,
    RenderContext, RequestOutput, SeedOutput, SourceDefinition, UserInput,
} from "./types";
export {createProfileHost} from "./host";
export {createProfileCatalog, defineProfile} from "./define";
export {Appending, Assistant, BUILTIN, Developer, Fragment, History, Image, Input, Prompt, Reminder, System, Tag, User, nodeComponent} from "./nodes";
export type {HistoryProps, ImageProps, MessageProps, ReminderProps, TagProps} from "./nodes";
