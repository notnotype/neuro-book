/** @jsxImportSource @notnotype/nb-profile */
import {AppendingSet, HistorySet, Message, ProfilePrompt, Reminder, System} from "@notnotype/nb-profile";

/**
 * 自定义组件：返回节点的普通函数，JSX 运行时会直接调用它。
 * 相邻字符串子节点之间会插入换行，所以句内插值用模板字符串，不写成 `回答使用{language}。`。
 */
function StyleGuide(props: {readonly language: string}) {
    return (
        <System>
            {`回答使用${props.language}。`}
            {"先给结论，再给理由。"}
        </System>
    );
}

export default (
    <ProfilePrompt>
        <System>你是一名写作助手，帮助作者修改小说章节。</System>
        <StyleGuide language="简体中文" />
        <Message>以下是之前的对话。</Message>
        <HistorySet />
        <AppendingSet>
            <Reminder>不要改动作者没有要求修改的段落。</Reminder>
        </AppendingSet>
    </ProfilePrompt>
);
