---
标签: ["state:local"]
---

# AnswerForm

产物页侧栏的答复表单（t10 起，t15 阶段 4 第 1 批改成分段）。分组用 `host/answers.ts` 的 `groupQuestions`（与 `QuestionPanel` 同一份）：

- **待答**：这一版里能答、还没答的题，每题一个控件（零件 `QuestionControl`），必答在前；标题写“必答 N · 选答 M”（没有选答时只写必答），与首页收件箱的“必答 N”同一口径；这一版新加的题标“新”；旧答复作废要重答的，题下写明原因；
- **已答**：这一版里能答、已经答了的题，只读显示答案、针对哪一版、什么时候答的与说明；点“改答”才变成控件，“取消改答”回到已答的那份、这道题不再交；
- **之前几版的题**（页面上已没有）不进表单：服务端不再收它们的答复（`question_earlier`），宿主经 `readonly` 插槽放只读的 `QuestionPanel`。

每题可以加说明，整份答复可以写备注。只交改过或新填的题与写了说明的题。清空了的题回到“没答”、不交（多选全取消、文字只剩空白；待答的单选、确认题选了之后多一个“清除选择”），不会因为它校验不过而整份交不了（t19）。取值按核心的 `validateAnswerValue` 与控制字符规则当场校验（同一份规则，不复制）。零件不发请求，按“提交”只发 `submit`。

## 布局

纵向一列：待答、已答、`readonly` 插槽、备注，最后是**贴底的提交栏**（`position: sticky; bottom: 0`，面层底色，上边一条分隔线）：`result` 插槽（提交的结果与这份答复的通知；限高 40vh、自己滚）、提交按钮与“已改 N 题 · 还有 M 道必答没答”。题多时人在下面填，按钮与结果都看得到。提交栏用负外边距抵掉父级左右 1rem 的内边距，铺满侧栏的宽；父级的内边距不是 1rem 时要跟着改。父级（滚动容器）不要留下内边距：sticky 按滚动容器的内边距框停，留了下内边距，提交栏会离底边一截，后面的内容从缝里露出来。

## 数据

```ts
interface AnswerFormProps {
    /** 最新一版的题与状态（`/api/artifact` 的 `questions`）；必填 */
    questions: QuestionState[];
    /** 最新一版的版本号：标“新”用；必填 */
    latestVersion: number;
    /** 提交中：控件与按钮禁用；必填 */
    pending: boolean;
    /** 提交超过 2 秒还没回来：显示“在等别的写入完成”；必填 */
    slow: boolean;
    /** 不能答的原因（主工作区不能写、来自分支、产物已关闭、看的不是最新一版）；有值时表单只读、不给“改答”并显示原因；必填，可为 null */
    disabledReason: string | null;
    /** 服务端按题号退回的错误；必填 */
    errors: Record<string, string>;
    /** 变了就清空本地的填写与“改答”（提交成功之后由页面加一）；必填 */
    resetKey: number;
}
interface AnswerFormEmits {
    /** 按下提交；`values` 只含改过或新填的题 */
    (event: "submit", answer: {values: Record<string, unknown>; comments: Record<string, string>; note: string | null}): void;
}
interface AnswerFormSlots {
    /** 已答之后、备注之前的只读内容（产物页放 QuestionPanel 的“之前几版的题”“已取代与撤回”）；可选 */
    readonly?: () => unknown;
    /** 提交栏里、按钮上面的内容（产物页放提交结果 WriteResult 与这份答复的“通知”）；可选。只在有内容时传，传了提交栏就会出现 */
    result?: () => unknown;
}
```

没有 expose。没有任何题能交时提交按钮禁用；待答与“改答”都没有时不画提交栏（除非传了 `result`）。`state:local` 是本地的填写、说明、“改答”与备注，`resetKey` 变了就清空。

## 注意事项

- 点“改答”时控件里是现在的答案（`host/answers.ts` 的 `editingValue`），不在加载时预填：提交成功后表单先按提交前的题表清空、新数据随后才到，代录或另一个标签页答的题也是推送来的，加载时预填会漏掉它们（多选题点“改答”加一项，原来的选项就丢了）。
- 只写了说明、没改取值的已答题，交的时候带上现在的答案（`submittedValue`）：答复文件里每道题都有取值，说明不会挂在一道没有取值的题上。
- 之前几版的题以前也在表单里、预填旧值、能改，看起来与本轮的题一样（开发者 10-14 问“v2 为什么还显示第一组题还能改”，Agent 报第二轮答复带了第一轮的旧题）。现在它们不进表单，服务端也拒收。
