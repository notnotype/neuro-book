/**
 * 摘要的提示词（docs/specs/agent/compaction.md 输出 5）。按写小说改造：这是第一版，开发者随实际写书的体验调。
 */

const SECTIONS = `摘要按下面的小节写，没有内容的小节写“无”：

## 用户的要求
用户提过的要求，引用原话，一条不漏。

## 约束与偏好
文风、人称、时态、禁忌，以及用户表达过的喜好。

## 已定的设定与情节决定
人物、世界观、时间线、伏笔，以及已经定下来的情节走向和为什么这样定。

## 进度
已完成的章节、正在写的部分、待办。

## 关键上下文
接着写要用到的文件地址、章节、引用的段落。能重新读到的内容只留地址，不抄正文。

## 未回答的问题
问过用户、还没有答复的问题，以及拿不准、要问用户的事。

## 下一步
接下来要做什么，引用用户最近的原话。`;

const RULES = `规则：
- 写给接手这项工作的自己看，读完就能接着写，不需要再问用户。
- 只写对话里确实有的内容，不推测，不补写。
- 对话里已有摘要时，它的“用户的要求”原样保留，再加上之后的新要求；其余小节合并更新。
- 最近几轮对话会原样保留，摘要不必重复它们的细节，写它们之前发生的事。
- 不要调用工具，只回复摘要本身。`;

const requirements = (require: readonly string[]): string => (require.length === 0 ? "" : `\n\n这次压缩的额外要求：\n${require.map((item) => `- ${item}`).join("\n")}`);

/** 就地压缩：追加在原样的对话之后的那条消息。 */
export const inplacePrompt = (require: readonly string[]): string => `上下文快满了。把上面到这里的对话写成摘要，之后的对话会从这份摘要接着。\n\n${SECTIONS}\n\n${RULES}${requirements(require)}`;

/** 摘要模型的系统提示词。 */
export const summarySystem = (require: readonly string[]): string => `你负责把一段写作对话写成摘要，之后的对话会从这份摘要接着。\n\n${SECTIONS}\n\n${RULES}${requirements(require)}`;

/** 摘要模型的那条消息：对话的文字，分段时后一段带前一段的摘要。 */
export const summaryInput = (segment: string, previous: string | null): string => (previous === null
    ? `下面是要写成摘要的对话：\n\n<conversation>\n${segment}\n</conversation>`
    : `下面是目前的摘要：\n\n<summary>\n${previous}\n</summary>\n\n下面是接着的对话。把它合进摘要，交回更新后的完整摘要：\n\n<conversation>\n${segment}\n</conversation>`);
