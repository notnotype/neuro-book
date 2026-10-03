# Writer Brief 格式规范

> 本文定义 `get_chapter_writer_brief` 编译出的 writer brief 的**格式契约**:有哪些段、每段从哪来、两种防全知模式的差异。writer profile 的 `description` 指向本文;leader 用 `get_agent_profile("writer")` 发现后按需读。
>
> 这是「brief 应该长什么样」的真相源。brief 的**内容来源**由 Plot Scene / ChapterBrief / World Engine / 规划层(Promise beats + open Decision)决定;**简化 vs 投喂**由防全知模式决定(见 [reference/world-engine/workflow.md](../world-engine/workflow.md) §6.2)。

## 一句话

brief = **框架 + 信息控制 + 规划任务/警告 + 查询指引**,不是正文草稿,也不复述 lorebook。设定指向 lorebook、状态指向 World Engine、文风归 writer profile;brief 只留「本章特有」的东西。

## 两种防全知模式

| 模式 | writer 能力 | brief 里的世界状态 |
| --- | --- | --- |
| **autonomous(自主全知,默认)** | Plot 只读 + World Engine 只读 + lorebook 读 | **只给查询提示**(查哪些 subject、哪个时间窗),不展开状态;writer 自查 |
| **curated(受控投喂,当前 leader 手动使用)** | 读不到设定源 | **展开过滤后的状态摘要**;leader 投喂前按「必须隐藏」删减 |

调用:`get_chapter_writer_brief({projectPath, chapterId, mode})`,`mode` 默认 `autonomous`。

## brief 段落骨架(编译器产出顺序)

1. **本章目标与落点** ← ChapterBrief.goal + ending(结尾定句)。
2. **本章参数(覆盖 writer 默认)** ← ChapterBrief.pov / tone。只写覆盖项:writer profile 已有默认人称/字数/文风,brief 不重复,只写本章要改的。
3. **信息控制(必填)** ← ChapterBrief.readerKnows / protagonistKnows / mustHide / hintOnly。**四项全空则 brief status = `needs_chapter_brief`,阻断 handoff**——这是防全知唯一的按章控制面,writer 有上帝视角查询能力,缺它会越界泄露。
4. **节奏 / 下一章牵引** ← ChapterBrief.pacing / opening。
5. **禁写** ← ChapterBrief.doNotWrite。
6. **关键剧情点(按 Scene)** ← 每个 Scene 的 summary(本场做什么)/ purpose(本场目的)/ writingTip / 所属 Thread summary。粒度默认粗(框架级),精细分镜版暂不做。
   - autonomous:每场附 `World 查询提示`(subject 列表 + 地点 + 时间窗)。
   - curated:每场展开 `World slices` + `Subject states` 摘要(不 dump raw attrs/patch JSON)。
7. **本章 Promise 任务**(Task 93 D25) ← 本章各 Scene 上的 PromiseBeat,按 Scene 分组输出任务行:`[建立]/[推进]/[反挫]/[兑现]` 标签 + 按 kind 固定的一句推进指令(埋设不解释/推进保悬念/反挫压回/兑现不复读),beat.note 全文作「本次指示」,payoffExpectation 全文只附在兑现任务上(默认详细形态)。段首固定提醒:把指令自然融入正文,不要照抄措辞。archived 场的 beats 不参与(D5),abandoned 线的 beats 不下发;**过滤后无任何任务时整段不出现**。
8. **未决决策警告**(Task 93 D26) ← 触及本章的 open Decision:决策 title/name、待决问题、候选方案、触及原因,措辞含「不得擅自写死」与「需要定论先联系 leader 拍板」。触及判定 = anchor 命中本章 / 本章内 Scene / 本章 Scene 所属 Thread / 本章 beats 的 Promise,外加 story 级且拍板期限距本章 ≤3 章序位(含期限已到/已过;期限章已删则无从计算章序,不触发);act/content 锚不做章级触及判定。判定口径**宁多勿漏**(漏报会被写死):触及集合不排除 archived 场与 abandoned 线,与上一段的下发严口径相反。**无触及时整段不出现;第一版不做 status 阻断**。
9. **建议读取** ← 由 Scene 的结构化 refs(content 类)编译,带 relation gloss。替代 leader 手写「设定复述」;writer 按需读,不必全读。

### 3 / 7 / 8 三段的分工

三段都在约束「writer 能写什么」,但防的错误与数据来源不同,互不替代:

| 段 | 防什么 | 来源与维护 |
| --- | --- | --- |
| 3 信息控制 | **防泄露**:writer 有上帝视角查询能力,本段划定本章知识边界(读者/主角知道什么、必须隐藏什么) | ChapterBrief 手填;三段中唯一参与 status 阶梯(`needs_chapter_brief` 阻断 handoff) |
| 7 本章 Promise 任务 | **防欠债**:规划期打的计划 beat 经此送达 writer,本章该推进的债务线推进到位、幅度按 note 收住 | PromiseBeat 派生,自动编译;有任务才出现 |
| 8 未决决策警告 | **防写死**:未拍板的问题保持开放,不替 leader 做决定 | open Decision 派生,自动编译;触及本章才出现 |

beat.note 也会出现「只写到发烫,不许发光」这类推进幅度指示,但它只管**单线单场**;本章整体的隐藏/暗示边界仍以信息控制为准。

## status 阶梯

`needs_plot`(无 Scene)→ `needs_world_anchor`(Scene 缺时间范围)→ `needs_world_context`(subject 未接入 World Engine)→ `needs_chapter_brief`(信息控制四项全空)→ `ready`。非 `ready` 时 leader 应先补齐再交接。规划层两段(本章 Promise 任务 / 未决决策警告)只追加内容,**不参与 status 阶梯**(是否升级 `needs_decision` 档待观察实际使用,Task 93 TODO)。

## 不进 brief 的东西

- **设定复述**:角色底设、力量体系、世界规则——指向 lorebook,不抄进 brief(双真相源会漂移)。
- **可查询状态**:HP / 位置 / 属性数值——autonomous 由 writer 查;curated 由编译器展开,但仍不 dump raw attrs/patch JSON。
- **文风约束**:文风、避讳词、show-don't-tell、markdown 方言——全在 writer profile(`<writing_style>`/`<avoid_words>`/`<char_performance>`),brief 不重复。

## 相关文档

- [system.md](system.md):Plot 两棵树、ChapterBrief 与 Promise / PromiseBeat / Decision 实体。
- [agent-spec.md](agent-spec.md):Promise 自由文本三层分工(summary / payoffExpectation / beat.note)与 Decision 纪律——第 7/8 段消费的字段怎么填。
- [../world-engine/workflow.md](../world-engine/workflow.md) §6:防全知模式、简化 vs 投喂、Leader-Writer 协作。
- [../agent/leader-default.md](../agent/leader-default.md):leader 调用 writer 的协议。
