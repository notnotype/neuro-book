import {describe, expect, it} from "bun:test";
import {acceptSubmission, applyComposerAction, commandMenu, nextMode, resolveSubmission, sendBlockedReason} from "./composer-actions";
import {createAgentContext} from "./context";
import type {PromptAttachment} from "./ports";

const COMMANDS = ["compact", "rename", "plan"];
const BOTH = {steer: true, followup: true};

describe("resolveSubmission", () => {
    it.each([
        {running: false, mod: false, delivery: "prompt"},
        {running: false, mod: true, delivery: "prompt"},
        {running: true, mod: false, delivery: "steer"},
        {running: true, mod: true, delivery: "followup"},
    ] as const)("运行中=$running、mod=$mod 时投递方式是 $delivery", ({running, mod, delivery}) => {
        expect(resolveSubmission({text: "  继续写第四章 \n", mod, running, commands: COMMANDS, deliveries: BOTH})).toEqual({kind: "message", text: "继续写第四章", delivery});
    });

    it.each([
        {deliveries: {steer: true, followup: false}, mod: false, expected: "steer"},
        {deliveries: {steer: true, followup: false}, mod: true, expected: null},
        {deliveries: {steer: false, followup: true}, mod: false, expected: "followup"},
        {deliveries: {steer: false, followup: true}, mod: true, expected: "followup"},
        {deliveries: {steer: false, followup: false}, mod: false, expected: null},
        {deliveries: {steer: false, followup: false}, mod: true, expected: null},
    ] as const)("运行中只允许 $deliveries、mod=$mod 时投递方式是 $expected（验收 23）", ({deliveries, mod, expected}) => {
        const result = resolveSubmission({text: "加快节奏", mod, running: true, commands: COMMANDS, deliveries});
        expect(result === null ? null : result.kind === "message" ? result.delivery : result.kind).toBe(expected);
    });

    it("命令不受运行中投递开关限制", () => {
        expect(resolveSubmission({text: "/compact", mod: false, running: true, commands: COMMANDS, deliveries: {steer: false, followup: false}}))
            .toEqual({kind: "command", name: "compact", argsText: ""});
    });

    it("空白正文不发送", () => {
        expect(resolveSubmission({text: " \n\t", mod: false, running: false, commands: COMMANDS, deliveries: BOTH})).toBeNull();
    });

    it("开头是登记的命令时执行命令，名称之后的文字是参数", () => {
        expect(resolveSubmission({text: "/rename  第三章 雨夜 ", mod: false, running: true, commands: COMMANDS, deliveries: BOTH}))
            .toEqual({kind: "command", name: "rename", argsText: "第三章 雨夜"});
        expect(resolveSubmission({text: "/compact\n只保留大纲", mod: true, running: false, commands: COMMANDS, deliveries: BOTH}))
            .toEqual({kind: "command", name: "compact", argsText: "只保留大纲"});
        expect(resolveSubmission({text: "/plan", mod: false, running: false, commands: COMMANDS, deliveries: BOTH}))
            .toEqual({kind: "command", name: "plan", argsText: ""});
    });

    it("没登记的命令、不在开头的命令按普通文字发送", () => {
        expect(resolveSubmission({text: "/unknown 参数", mod: false, running: false, commands: COMMANDS, deliveries: BOTH}))
            .toEqual({kind: "message", text: "/unknown 参数", delivery: "prompt"});
        expect(resolveSubmission({text: "先 /plan", mod: false, running: false, commands: COMMANDS, deliveries: BOTH}))
            .toEqual({kind: "message", text: "先 /plan", delivery: "prompt"});
        expect(resolveSubmission({text: "/planning", mod: false, running: false, commands: COMMANDS, deliveries: BOTH}))
            .toEqual({kind: "message", text: "/planning", delivery: "prompt"});
    });
});

describe("nextMode", () => {
    const modes = [{key: "normal", label: "普通"}, {key: "discuss", label: "讨论"}, {key: "plan", label: "规划"}];

    it("按顺序循环，最后一种回到第一种", () => {
        expect(nextMode(modes, "normal")).toBe("discuss");
        expect(nextMode(modes, "plan")).toBe("normal");
    });

    it("当前模式不在列表里时回到第一种；少于两种时没有可切换的", () => {
        expect(nextMode(modes, "gone")).toBe("normal");
        expect(nextMode(modes.slice(0, 1), "normal")).toBeNull();
    });
});

describe("commandMenu", () => {
    const commands = [
        {id: "compact", name: "compact", description: "压缩上下文", argsHint: "补充要求"},
        {id: "plan", name: "plan", description: "切到规划模式", argsHint: null},
        {id: "replan", name: "replan", description: "重新规划", argsHint: null},
    ];
    const labels = {title: "命令", empty: "没有这个命令"};

    it("按名称过滤，名称以查询开头的排在前面，参数提示写进说明", () => {
        const menu = commandMenu(commands, "pla", labels);
        expect(menu.items.map((item) => item.label)).toEqual(["/plan", "/replan"]);
        expect(commandMenu(commands, "", labels).items[0]).toEqual({
            id: "command:compact", label: "/compact", description: "压缩上下文 · 补充要求", iconClass: "i-lucide-square-slash", insertText: "/compact",
        });
    });

    it("没有匹配时给出空结果文字", () => {
        expect(commandMenu(commands, "zz", labels)).toEqual({title: "命令", items: [], emptyText: "没有这个命令"});
    });
});

describe("sendBlockedReason", () => {
    const states = new Map<string, PromptAttachment>([
        ["a", {localId: "a", state: "ready", target: "session://attachments/a.png"}],
        ["b", {localId: "b", state: "uploading"}],
        ["c", {localId: "c", state: "failed", error: "太大"}],
    ]);

    it("发出过的附件都就绪时不挡发送", () => {
        expect(sendBlockedReason(new Set(["a"]), states)).toBeNull();
        expect(sendBlockedReason(new Set(), states)).toBeNull();
    });

    it("有上传中的、或宿主还没登记状态的，按上传中挡住", () => {
        expect(sendBlockedReason(new Set(["a", "b"]), states)).toBe("uploading");
        expect(sendBlockedReason(new Set(["z"]), states)).toBe("uploading");
    });

    it("失败优先于上传中：用户要先重试或移除", () => {
        expect(sendBlockedReason(new Set(["b", "c"]), states)).toBe("failed");
    });
});

describe("宿主起步：输入框动作", () => {
    const composer = createAgentContext({composer: {recall: ["继续写", "第三章"], draft: {text: "继续写", version: 3}}}).composer;

    it("草稿回声只换文字不换版本；模式、模型与思考档位直接写回", () => {
        expect(applyComposerAction(composer, {type: "composer.draftChanged", text: "继续写第四"})?.draft).toEqual({text: "继续写第四", version: 3});
        expect(applyComposerAction(composer, {type: "mode.set", mode: "plan"})?.mode).toBe("plan");
        expect(applyComposerAction(composer, {type: "model.set", modelKey: "m2"})?.modelKey).toBe("m2");
        expect(applyComposerAction(composer, {type: "thinking.set", level: "high"})?.thinking).toBe("high");
    });

    it("附件与发送不在这里：返回 null，宿主要接着上传或执行", () => {
        expect(applyComposerAction(composer, {type: "composer.attachmentRetry", localId: "a1"})).toBeNull();
        expect(applyComposerAction(composer, {type: "composer.submit", text: "继续写", delivery: "prompt"})).toBeNull();
    });

    it("受理发送或命令：草稿原文进输入历史最前并去重，草稿清空并换版本；命令只差空白也认得是草稿", () => {
        expect(acceptSubmission(composer, "继续写")).toMatchObject({recall: ["继续写", "第三章"], draft: {text: "", version: 4}});
        const command = {...composer, draft: {text: "/rename  第三章  雨夜", version: 3}};
        expect(acceptSubmission(command, "/rename 第三章  雨夜").recall).toEqual(["/rename  第三章  雨夜", "继续写", "第三章"]);
    });

    it("发送的不是草稿（宿主组件发出的追问）：输入框里写到一半的字不动，也不记进历史", () => {
        const writing = {...composer, draft: {text: "写到一半", version: 3}};
        expect(acceptSubmission(writing, "再问一次")).toBe(writing);
    });
});

