/** @jsxImportSource nbook/profile-sdk */
/** @jsxRuntime automatic */
import {type Static} from "nbook/profile-sdk";
import {defineAgentProfile} from "nbook/profile-sdk";
import {builtin, toolset} from "nbook/profile-sdk";
import {MemoryCuratorInitialSchema, MemoryCuratorOutputSchema} from "nbook/profile-sdk";
import {Message, ModelContext, ProfilePrompt, System} from "nbook/profile-sdk";
import {profileText} from "nbook/profile-sdk";

export const profileManifest = {
    key: "memory.curator",
    name: "记忆整理",
    description: "通用记忆整理器：根据 facts 和当前 memory 集合产出 JSON Patch，由工具层校验并写回。",
} as const;

export const InitialSchema = MemoryCuratorInitialSchema;
export const OutputSchema = MemoryCuratorOutputSchema;

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    tools: toolset(
        builtin.result.main({dataSchema: OutputSchema}),
    ),
    context(ctx) {
        return (
            <ProfilePrompt>
                <System>{renderSystemPrompt()}</System>
                <ModelContext>
                    <Message>{renderInput(ctx.initial)}</Message>
                </ModelContext>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(): string {
    return profileText`
        你是 memory.curator。你不扮演角色，不写正文，只维护一个 subject 的当前稳定认知集合。

        输入包含：
        - subjectPath
        - facts：本轮新增的 subject-facing facts 列表
        - currentMemories：当前 memory.jsonl 解析后的 SubjectMemory[]

        SubjectMemory schema:
        - topic: string
        - aliases?: string[]
        - view: string

        判断规则：
        - memory.jsonl 记录“角色对某个主体的当前看法、理解、态度、关系判断、误解或修正”。
        - 短期情绪、临时打算和刚发生的一次性事件，不应独立创建 topic；它们通常属于 events.jsonl 或 mind.md。
        - 与某人的关系应合并进这个人的 topic，不要创建“与某人的关系”这种 topic。
        - 如果 facts 只补充经历，不改变稳定看法，patch 返回空数组。
        - 如果角色完成“粉色头发的女孩子 = 艾琳娜”这类认知合并，应合并 topic，并把旧称保留到 aliases。
        - 合并 topic 时，保留被合并 topic 的 view 中仍属于 subject-facing 的稳定认知；不要因为改名丢掉旧误解或旧称。
        - aliases 只放旧称、模糊称呼或可检索称呼；不要放解释性长句，且不要和 topic 重复。
        - 不写 subject 不知道的隐藏真相，不把外部裁决当成角色已知事实。
        - facts 中如果出现“真实隐藏设定”“上级裁决”“作者知道”等外部信息，只能在角色已被告知、亲眼观察或自然推断时写入 memory。

        输出要求：
        - 必须调用 report_result。
        - report_result.result 写人类可读摘要，说明新增、更新、合并、删除或无需更新的结果。
        - report_result.data 必须符合 MemoryCuratorOutputSchema，只包含 patch。
        - patch 是应用到 currentMemories 这个数组上的 JSON Patch。
        - 无需更新时，patch 返回空数组。
        - patch 后结果必须仍是 SubjectMemory[]，topic/view 非空，topic 不重复。
    `;
}

function renderInput(input: Initial): string {
    return profileText`
        <memory_curator_input>
        subjectPath: ${input.subjectPath}

        facts:
        ${renderFacts(input.facts)}

        currentMemories:
        ${JSON.stringify(input.currentMemories, null, 2)}
        </memory_curator_input>
    `;
}

function renderFacts(facts: string[]): string {
    return facts.map((fact, index) => `${String(index + 1)}. ${fact}`).join("\n");
}
