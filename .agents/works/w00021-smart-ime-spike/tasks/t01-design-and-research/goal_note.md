# 目标定义

我们要训练的不是“拼音转汉字模型”，而是一个 **Context-Aware Generative IME Model**：

\[
\boxed{P_\theta(Y\mid X,C)}
\]

其中：

- \(X\)：用户输入信号，第一阶段先限定为键盘拼音序列
- \(C\)：当前局部上下文
- \(Y\)：用户真正想输入的中文

例如：

```text
Context:
苏天晴刚刚结束战斗，她对自己的表现十分满意。

Input:
stqrwzjhb

Output:
苏天晴认为自己很棒
```

核心不是学会：

```text
stq → 苏天晴
hb → 很棒
```

而是学会：

> 综合输入编码、句法、语义和上下文，恢复用户真正想表达的文本。

---

# 核心假设

传统 IME 更接近：

\[
P(Y\mid X)
\]

我们希望做的是：

\[
P(Y\mid X,C)
\]

未来才扩展成：

\[
P(Y\mid X,C,U,M)
\]

其中：

- \(U\)：用户长期偏好
- \(M\)：外部 Memory / RAG

但 **V0 完全不做 RAG、用户记忆、在线学习**。

这些属于接入层或者后续 personalization。

现在只验证：

> 小型 LLM 能否仅凭 local context + noisy/ambiguous keystrokes，完成高质量中文输入解码。

---

# 一个关键设计原则

**不要使用 n-gram 或弱模型提前生成完整句子候选。**

因为会产生 early pruning：

```text
stqrwzjhb
```

如果弱模型没生成：

```text
苏天晴认为自己很棒
```

后面的强模型再聪明也没用。

所以核心模型直接：

```text
Context
   +
Keystrokes
   ↓
Generative LM
   ↓
Chinese Text
```

不经过完整候选生成阶段。

phonetic lattice、词典、RAG 等以后都可以作为辅助，但不是核心依赖。

---

# 对输入错误的态度

不把按键作为 hard constraint。

例如：

```text
woaizhenliwanju
```

虽然严格拼音更接近：

```text
wo ai zhen li wan ju
```

模型应该可以根据语言理解恢复：

```text
我爱整理玩具
```

因为正确拼音实际上是：

```text
wo ai zheng li wan ju
```

用户只是漏了 `g`。

所以我们的模型应该天然支持：

```text
n/ng
en/eng
in/ing
z/zh
c/ch
s/sh
l/n
f/h
漏键
多键
错键
换位
```

也就是：

> keystrokes 本身是一种有噪声的 human intention encoding。

---

# Dataset Schema

训练数据的最小形式：

```json
{
  "context": "苏天晴刚刚结束战斗，她对今天的表现十分满意。",
  "input": "stqrwzjhb",
  "target": "苏天晴认为自己很棒"
}
```

实际数据生成时建议保存：

```json
{
  "id": "sample_000001",

  "context": "...",
  "target": "苏天晴认为自己很棒",

  "canonical_pinyin": "sutianqingrenweizijihengbang",
  "input": "stqrwzjhb",

  "input_type": "initials",
  "noise_type": [],
  "noise_level": 0,

  "source": "novel",
  "domain": "fiction"
}
```

metadata 不一定喂给模型，主要用于：

- 数据分布分析
- curriculum sampling
- benchmark 分组
- 错误分析

---

# 数据如何产生

任何中文语料都可以转成 IME 数据：

```text
Chinese Corpus
      ↓
切分 Context / Target
      ↓
Target → Pinyin
      ↓
Input Simulator / Corruption Generator
      ↓
(Context, Input, Target)
```

例如：

```text
Target:
苏天晴认为自己很棒

Canonical:
su tian qing ren wei zi ji hen bang
```

可以自动生成：

```text
sutianqingrenweizijihengbang
stqrwzjhb
sutqrwzjhb
stqingrwzjihb
sutianqinrenweizijihengbang
stqrwzijhb
...
```

所以训练数据可以大规模自动生成。

---

# Corruption Generator

这里其实更准确叫：

**Keystroke / Input Simulator**

它需要模拟真实用户输入方式：

1. 全拼

```text
sutianqingrenweizijihengbang
```

2. 全简拼

```text
stqrwzjhb
```

3. 部分简拼

```text
sutqrwzjhb
stqingrweizjhb
sutianqrwzjihb
```

4. 拼写错误

```text
delete
insert
replace
transpose
```

5. 中文常见模糊拼音

```text
zh ↔ z
ch ↔ c
sh ↔ s
eng ↔ en
ing ↔ in
n ↔ l
...
```

6. 多错误组合

例如：

```text
woaizhengliwanju
→ woaizhenliwanju
→ woaizhnelwanju
```

但必须控制 noise level，不能无限破坏。

---

# 最重要的数据：Context Ambiguity

普通自动生成数据有一个危险：

模型可能只学习：

\[
P(Y\mid X)
\]

完全无视 context。

所以必须专门构造：

\[
\boxed{
X相同，C不同，Y不同
}
\]

例如：

```text
Input:
stqrwzjhb
```

Context A：

```text
苏天晴刚获得冠军，非常满意自己的表现。
```

Target：

```text
苏天晴认为自己很棒
```

Context B：

```text
苏天晴连续犯了几个低级错误，非常自责。
```

Target：

```text
苏天晴认为自己很笨
```

两句话：

```text
苏天晴认为自己很棒
苏天晴认为自己很笨
```

首字母都是：

```text
stqrwzjhb
```

模型只有真正理解上下文才能区分。

**这类数据是整个项目最关键的数据资产之一。**

---

# Training Curriculum

训练不要一开始什么都混进去，而是逐步增加难度。

可以按以下顺序：

1. **Exact Pinyin**

```text
sutianqingrenweizijihengbang
→ 苏天晴认为自己很棒
```

先学会基本任务。

2. **Full Mode**

加入：

```text
full pinyin
initials
partial abbreviation
```

3. **Noise**

逐渐加入：

```text
typo
fuzzy pinyin
missing key
extra key
swap
```

4. **Contextual Disambiguation**

大量加入：

```text
same X
different Context
different Target
```

最终训练 mixture 可以类似：

```text
普通 FK2C                 50%
Context ambiguity         30%
Noisy input               15%
Hard counterfactual        5%
```

具体比例后面实验调。

---

# 模型训练形式

第一版建议直接使用 Base LM，而不是 Chat/Instruct。

例如：

```text
Qwen3-0.6B-Base
```

先验证 hypothesis。

训练输入：

```text
<ctx>
苏天晴刚刚结束战斗，她对自己的表现十分满意。
</ctx>
<keys>
stqrwzjhb
</keys>
<text>
苏天晴认为自己很棒
</text>
```

Loss 只计算：

```text
苏天晴认为自己很棒
```

前面的：

```text
context + keys
```

全部 mask。

标准 autoregressive cross entropy 即可：

\[
L=-\sum_t \log P_\theta(y_t\mid C,X,y_{<t})
\]

第一版：

**不需要**

```text
RLHF
Reward Model
特殊 Decoder
PySeg Head
RAG
User Embedding
自定义 Tokenizer
```

先纯 SFT。

---

# 为什么先 0.6B

V0 不是追求产品最终效果。

而是回答：

> 这个任务成立吗？

所以先：

```text
Qwen3-0.6B-Base
+
LoRA
+
几十万训练 pairs
```

如果它已经明显学会：

```text
stqrwzjhb
+
context
→
正确中文
```

并且 context 能影响答案，那么方向就成立。

之后再做：

```text
0.6B
1.7B
4B
```

得到 scaling curve。

---

# Evaluation Benchmark

不能只看 validation loss。

至少需要测这些能力：

| Benchmark | 测什么 |
|---|---|
| Clean P2C | 正确全拼转中文 |
| Initial FK2C | 简拼 |
| Partial FK2C | 全拼+简拼混合 |
| Noise Robustness | typo / fuzzy 拼音 |
| Context Disambiguation | 是否真的理解上下文 |
| Input Faithfulness | 是否过度无视用户输入 |

最重要的是：

### Context Disambiguation Accuracy

固定：

```text
same X
```

只改变：

```text
Context
```

看模型是否正确改变输出。

还可以计算：

\[
ContextGain
=
Acc_{with\ context}
-
Acc_{without\ context}
\]

例如：

```text
without context  51%
with context     84%

ContextGain = +33pp
```

这个指标非常能说明模型到底有没有学会你的核心能力。

---

# Input Faithfulness

虽然允许纠错，但不能让模型完全无视输入。

所以另外记录：

\[
EditDistance(
Pinyin(Output),
Input
)
\]

但是它只是分析指标，不应该成为 hard constraint。

因为我们本来就希望允许：

```text
zhenli
→ 整理
→ zhengli
```

这种合理 correction。

---

# V0 实验

我会把第一次实验明确限定为：

> 使用 Qwen3-0.6B-Base，在不使用候选生成、词典、RAG、外部 decoder、用户记忆的情况下，通过 SFT 学习 `local context + arbitrary pinyin keystrokes → Chinese text`。

第一批数据：

```text
原始中文段落
        ↓
约 10 万 target
        ↓
每个生成 2~4 个 input variant
        ↓
约 30~50 万训练样本
```

再单独制作：

```text
1,000~5,000
Context Ambiguity Benchmark
```

必须完全隔离，永远不进训练集。

---

# V0 成功标准

不是：

```text
nihao → 你好
```

也不是：

```text
nh → 你好
```

甚至：

```text
woaizhenliwanju
→ 我爱整理玩具
```

都还只是第二层能力。

真正的核心证明是：

\[
\boxed{
\text{Same Keystrokes}
+
\text{Different Context}
\rightarrow
\text{Different Correct Text}
}
\]

例如：

```text
Context A + stqrwzjhb
→ 苏天晴认为自己很棒

Context B + stqrwzjhb
→ 苏天晴认为自己很笨
```

一旦这个能力被稳定训练出来，我们就已经证明：

> **输入法可以从传统的拼音统计解码问题，升级成一个 contextual intent decoding 问题。**

之后再加入用户记忆、RAG、个性化、在线反馈学习、端侧推理和低延迟优化，都是下一阶段。