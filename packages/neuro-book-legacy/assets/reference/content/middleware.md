# 内容校验与规范化规范 v0.2

## 一、文档定位

本文档定义各类文本与引用相关字段在 `POST / PUT / PATCH` 提交后的统一处理能力。

本文档不再使用 “Middleware” 这个命名，因为这里的能力边界已经很固定：

- refs 校验
- inline ref 规范化
- 领域前置校验辅助

相关文档：

- [内容引用规范](content-references.md)
- [AI 表单批注历史（已归档）](../../../docs/archived/ai-annotation.md)；它不是当前内容规范。

---

## 二、设计目标

- 给 lorebook / character / plot / chapter 提供统一提交校验入口
- 把字段校验、ref 校验、inline 解析收束到同一条服务链路
- 保持各领域 service 继续只关心业务规则，不关心文本解析细节
- 与 AI 表单批注接口解耦

---

## 三、职责边界

内容校验与规范化服务负责：

- 字段级文本预处理
- inline ref 解析与校验
- structured ref 规范化与校验
- 生成派生结果与诊断信息

它不负责：

- AI 表单批注执行
- 事务编排
- UI 菜单候选生成
- 长链路 agent 编排

---

## 四、统一处理顺序

建议所有文本类提交统一走以下顺序：

### 1. 请求 DTO 校验

先做最基础的 schema 校验：

- 类型
- 长度
- 必填约束

---

### 2. structured ref 规范化

对 `refs` 字段执行：

- target 语法解析
- legacy target 兼容
- 规范 target 输出
- 目标存在性校验

输出：

- `normalizedRefs`
- `refDiagnostics`

---

### 3. inline ref 解析

对允许的文本字段执行：

- 提取 Markdown link
- 提取编辑态 `@uri`
- 兼容 legacy `[@](@uri)`
- 规范化为标准 Markdown link

输出：

- `normalizedTextFields`
- `inlineRefs`
- `inlineRefDiagnostics`

---

### 4. 领域级校验

此时再交给领域 service 做最终业务判断。

例如：

- lorebook path / parent 规则
- plot scope 规则
- chapter 归属规则
- scene / plot 排序规则

---

### 5. 落库

最终落库的是：

- 规范化后的 `refs`
- 规范化后的文本字段

不作为业务真相源落库的是：

- `inlineRefs`
- 运行期 diagnostics

---

## 五、统一输出模型

建议内部统一使用如下结果概念：

```yaml
contentResult:
  text:
    summary:
      raw: string
      normalized: string
      resolved: string
      inlineRefs: []

  refs:
    raw: []
    normalized: []

  diagnostics:
    errors: []
    warnings: []
    notes: []
```

说明：

- `raw` 是原始输入
- `normalized` 是语法规范化结果
- `resolved` 在当前版本等于 `normalized`

---

## 六、适用模块

### 1. Lorebook / Character

应接入：

- 条目创建
- 条目元数据更新
- 条目正文更新
- VFS frontmatter 写回

---

### 2. Plot

应接入：

- thread 创建 / 更新
- scene 创建 / 更新
- plot 创建 / 更新

---

### 3. Chapter

本轮接入：

- `chapter content.put`
- `chapter summary` 等元数据保存

说明：

- `Chapter.content` 继续使用现有正文编辑器
- 章节正文可以继续消费 inline 引用规范化
- 章节正文不属于本轮智能批注编辑器接入范围

---

## 七、错误与诊断策略

建议把错误分成三类：

### 1. hard error

必须阻止提交。

例如：

- target 协议非法
- 引用目标不存在
- inline 引用语法损坏

---

### 2. soft warning

允许提交，但应返回警告。

例如：

- legacy 写法被自动规范化
- pending 引用尚未落地
- 某个字段存在重复 inline 引用

---

### 3. execution note

仅用于提示和调试。

例如：

- 本次识别了几个 inline ref
- 哪些字段发生了自动规范化

---

## 八、与 AI 表单批注的关系

内容校验与规范化服务和 AI 表单批注接口是两条链路：

- AI 表单批注接口：改草稿，不落库
- 原表单提交接口：做最终校验与保存

前者的输出草稿在真正提交时，仍要进入本服务再次做：

- refs 校验
- inline ref 规范化
- 领域前置校验

---

## 九、推荐依赖方向

推荐依赖方向：

```text
route
  -> 内容校验与规范化服务
      -> inline ref parser
      -> structured ref normalizer
  -> domain facade / service
```

AI 表单批注接口走另一条线：

```text
route
  -> schema metadata registry
  -> yaml working draft builder
  -> AI patch provider
  -> draft result
```

---

## 十、一句话总结

> 所有文本与引用相关字段的提交  
> 都应先进入统一的内容校验与规范化服务  
> AI 只负责改草稿  
> 最终仍由原表单提交接口做校验、规范化与保存
