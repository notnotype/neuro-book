/** @jsxImportSource @notnotype/nb-profile */
import {HistorySet, ProfilePrompt, System} from "@notnotype/nb-profile";

export default (
    <ProfilePrompt>
        <System>你是 nb-profile 的测试助手。</System>
        <System>第二段系统提示。</System>
        <HistorySet />
    </ProfilePrompt>
);
