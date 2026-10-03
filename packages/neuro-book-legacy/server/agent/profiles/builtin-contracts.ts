import {Type} from "typebox";

/**
 * leader.default / leader.assets 的实例初始化参数。Project 归属由 session metadata 承载。
 */
export const LeaderDefaultInitialSchema = Type.Object({});

/**
 * leader.default 的结构化输出合同。
 */
export const LeaderDefaultOutputSchema = Type.Object({
    result: Type.Optional(Type.String({description: "可选总结文本。leader.default 通常不要求 report_result。"})),
});

/**
 * 世界模拟主管的实例初始化参数。当前 Project 由 Session currentProjectRoot 承载。
 */
export const SimulatorLeaderInitialSchema = Type.Object({});

/**
 * Legacy / RP 世界模拟主管返回普通 assistant 文本，不绑定 report_result.data 结构。
 */
export const SimulatorLeaderOutputSchema = Type.Object({});

/**
 * rp.leader 的实例初始化参数。当前 Project 由 Session currentProjectRoot 承载。
 */
export const RpLeaderInitialSchema = Type.Object({});

/**
 * rp.leader 返回普通 assistant 文本，不绑定 report_result.data 结构。
 */
export const RpLeaderOutputSchema = Type.Object({});

/**
 * director 的实例初始化参数。每轮剧情任务通过 invoke_agent.message 传入。
 */
export const DirectorInitialSchema = Type.Object({
    projectRoot: Type.String({description: "Single-segment Project root, e.g. silver-dragon-hime."}),
    mode: Type.Optional(Type.Union([
        Type.Literal("writing"),
        Type.Literal("rp"),
        Type.Literal("analysis"),
    ], {description: "Stable operating mode for this director session."})),
    defaultChapterPath: Type.Optional(Type.String({description: "Optional default manuscript chapter path for this director session."})),
});

/**
 * director 通过 report_result.data 返回的结构化剧情设计结果。
 */
export const DirectorOutputSchema = Type.Object({
    summary: Type.String({description: "本轮剧情设计的人类可读总结。"}),
    status: Type.Union([
        Type.Literal("completed"),
        Type.Literal("needs_user"),
        Type.Literal("blocked"),
    ], {description: "本轮导演任务状态。"}),
    plot_updates: Type.Array(Type.Object({
        kind: Type.Union([
            Type.Literal("thread"),
            Type.Literal("scene"),
        ], {description: "被处理的 Plot System 对象类型。"}),
        action: Type.Union([
            Type.Literal("created"),
            Type.Literal("updated"),
            Type.Literal("read"),
            Type.Literal("skipped"),
        ], {description: "本轮对该对象的操作。"}),
        id: Type.Optional(Type.String({description: "对象 id；没有落库时为空。"})),
        title: Type.Optional(Type.String({description: "对象标题；没有时为空。"})),
        summary: Type.String({description: "该对象的操作摘要。"}),
    }, {additionalProperties: false}), {description: "本轮 Plot System 读写摘要。没有则返回空数组。"}),
    chapter_plan: Type.String({description: "章节级剧情计划或空字符串。"}),
    writer_handoff: Type.String({description: "可交给 writer 的剧情结构 handoff。"}),
    world_engine_requests: Type.Array(Type.String({description: "需要 leader.default 用 World Engine 处理，或由 leader.default 转交 world.engine 的未决世界状态问题。director 不直接写 World Engine。"}), {description: "没有则返回空数组。"}),
    open_questions: Type.Array(Type.String({description: "需要 leader 或用户确认的问题。"}), {description: "没有则返回空数组。"}),
}, {additionalProperties: false});

/**
 * simulator.actor 的实例初始化参数。每轮 actor-facing message 通过 invoke_agent.message 传入。
 */
export const SubjectSimulatorInitialSchema = Type.Object({
    subjectPath: Type.String({description: "subject simulator目录路径，相对当前Project Workspace，例如 simulation/subjects/erina。"}),
    kind: Type.Union([Type.Literal("player"), Type.Literal("npc")], {
        description: "subject 类型。player：用户化身，actor 不主动行动/抢话，只把 leader 的 directive 第一人称自然化复述；npc：模拟器自由扮演。调用 actor 前按 subject.md frontmatter 的 kind 显式传入。第一版仅支持 player/npc。",
    }),
});

/**
 * simulator.actor 通过 report_result.data 返回的结构化角色反应。
 */
export const SubjectSimulatorOutputSchema = Type.Object({
    visible_response: Type.String({description: "第一人称：旁人能观察到我的动作、神态、姿态、沉默或行为反应；没有则填空字符串。"}),
    spoken_dialogue: Type.String({description: "第一人称：我说出口的台词原文；没有则填空字符串。"}),
    inner_response: Type.String({description: "第一人称：我没有说出口的情绪、意图、判断、误解或短期打算；没有则填空字符串。"}),
});

/**
 * memory.curator 的输入。调用方报告 facts，不指定具体 patch 操作。
 */
export const MemoryCuratorInitialSchema = Type.Object({
    subjectPath: Type.String({description: "被维护的 subject directory path。"}),
    facts: Type.Array(Type.String({description: "本轮新增的 subject-facing fact。不要写具体 JSON Patch 操作要求。"}), {minItems: 1, description: "本轮新增的 subject-facing facts。调用方只报告事实，不指定具体 patch 操作。"}),
    currentMemories: Type.Array(Type.Object({
        topic: Type.String({description: "当前认知主体。"}),
        aliases: Type.Optional(Type.Array(Type.String(), {description: "旧称、模糊称呼或合并后的别名。"})),
        view: Type.String({description: "角色对该主体的当前看法、理解、态度、关系判断、误解或修正。"}),
    }), {description: "当前 memory.jsonl 内容。"}),
});

/**
 * memory.curator 通过 report_result.data 返回 JSON Patch。
 */
export const MemoryCuratorOutputSchema = Type.Object({
    patch: Type.Array(Type.Object({
        op: Type.String({description: "RFC 6902 operation: add/remove/replace/move/copy/test."}),
        path: Type.String({description: "JSON Pointer path."}),
        from: Type.Optional(Type.String({description: "move/copy 的来源 JSON Pointer。"})),
        value: Type.Optional(Type.Unknown({description: "add/replace/test 的值。"})),
    }, {additionalProperties: false}), {description: "应用到 SubjectMemory[] 的 JSON Patch。无更新返回空数组。"}),
}, {additionalProperties: false});

/**
 * rp.writer 的实例初始化参数为空。每轮 Writer Brief 通过 invoke_agent.message 传递。
 */
export const RpWriterInitialSchema = Type.Object({}, {
    additionalProperties: false,
});

/**
 * rp.writer 使用 report_result.result 回报问题或写入落点，不绑定 report_result.data 结构。
 */
export const RpWriterOutputSchema = Type.Object({});

/**
 * summarizer 的实例初始化参数。sourceSessionId 由 harness 注入。
 */
export const SessionSummarizerInitialSchema = Type.Object({
    sourceSessionId: Type.Number({description: "由 harness 注入的 source session id。"}),
    trigger: Type.Optional(Type.Union([
        Type.Literal("afterInvocation"),
    ], {description: "触发时机。第一版仅支持 afterInvocation。"})),
    interval: Type.Optional(Type.Object({
        kind: Type.Union([
            Type.Literal("sourceInvocation"),
            Type.Literal("dialogueContentTokens"),
        ]),
        value: Type.Number({description: "触发间隔。sourceInvocation 表示 source invocation 次数，dialogueContentTokens 表示新增正文 token。"}),
    }, {description: "后台摘要周期触发配置。"})),
    maxDialogueContentTokens: Type.Optional(Type.Number({description: "Agent Dialogue Content 超过该 token 估算值时跳过本次摘要。"})),
});

/**
 * summarizer 通过 report_result.data 返回的展示元数据。
 */
export const SessionSummarizerOutputSchema = Type.Object({
    title: Type.String({description: "简短 session 标题，建议不超过 32 字。"}),
    summary: Type.String({description: "当前 session 的可读摘要，建议不超过 240 字。"}),
});

/**
 * writer 的长期实例初始化参数为空。每轮写作任务通过 invoke_agent.message + PayloadSchema 传入。
 */
export const WriterInitialSchema = Type.Object({}, {
    additionalProperties: false,
});

/**
 * inline.editor 的实例初始化参数为空。每轮编辑任务通过 invoke_agent.message + PayloadSchema 传入。
 */
export const InlineEditorInitialSchema = Type.Object({}, {
    additionalProperties: false,
});

/**
 * inline.editor 单次 invocation payload。message 承载用户可见任务回执，payload 是稳定编辑协议。
 */
export const InlineEditorPayloadSchema = Type.Object({
    version: Type.Literal(1),
    task: Type.Union([
        Type.Literal("chat"),
        Type.Literal("rewrite"),
        Type.Literal("polish"),
        Type.Literal("expand"),
        Type.Literal("condense"),
        Type.Literal("continue_after"),
        Type.Literal("bridge"),
    ], {description: "Inline AI 编辑任务类型。chat 在 UI 中显示为对话，但仍允许根据上下文编辑文件。continue_after 在 UI 中显示为续写。"}),
    targetPath: Type.String({minLength: 1, description: "本轮主要修改目标文件路径，使用当前Project Workspace相对路径，如 manuscript/001/index.md。"}),
    instruction: Type.String({description: "用户输入的自然语言编辑要求。可以为空，表示按 task 默认语义处理。"}),
    references: Type.Array(Type.Object({
        ref: Type.String({minLength: 1, description: "可见 selection chip，如 [[manuscript/001/index.md#L12-L18]]。"}),
        path: Type.String({minLength: 1, description: "引用来源文件路径，使用当前Project Workspace相对路径，如 manuscript/001/index.md。"}),
        range: Type.Optional(Type.Object({
            startLine: Type.Number({minimum: 1}),
            endLine: Type.Number({minimum: 1}),
        }, {additionalProperties: false})),
        match: Type.Union([
            Type.Literal("unique"),
            Type.Literal("ambiguous"),
            Type.Literal("unknown"),
        ], {description: "前端对选区正文行号定位的置信状态。"}),
        text: Type.String({description: "完整选区正文，只出现在 hidden payload 中。"}),
    }, {additionalProperties: false}), {description: "用户加入的选区引用。为空时由 AI 根据 targetPath 和 instruction 判断最小修改范围。"}),
}, {additionalProperties: false});

/**
 * inline.editor 使用 report_result.result 回报修改摘要，不绑定 report_result.data 结构。
 */
export const InlineEditorOutputSchema = Type.Object({}, {
    additionalProperties: false,
});

/**
 * writer 单次 invocation payload。message 承载自然语言任务，payload 只承载目标文件和建议读取清单。
 */
export const WriterPayloadSchema = Type.Object({
    path: Type.String({
        minLength: 1,
        description: "本轮写入或修改的目标Markdown文件路径，必须相对当前Project Workspace，例如 manuscript/001-volume/001-chapter/index.md。writer只能写这个路径。",
    }),
    // 自主模式:leader 传本章 StoryChapter id,writer 自行 get_chapter_writer_brief 取 brief。
    chapterId: Type.Optional(Type.String({
        minLength: 1,
        description: "本章对应的 StoryChapter id。autonomous 模式下 writer 可用它调 get_chapter_writer_brief 自取章节 brief;缺省时以 message 中的 brief 为准。",
    })),
    context: Type.Optional(Type.Object({
        lorebookEntries: Type.Optional(Type.Array(Type.String({
            minLength: 1,
            description: "建议 writer 按需读取的内容节点路径，可是 Project 内目录或 .md 文件。",
        }))),
        readablePaths: Type.Optional(Type.Array(Type.String({
            minLength: 1,
            description: "建议 writer 按需读取的普通 Markdown 文件路径，必须是 Project 内路径。",
        }))),
    }, {additionalProperties: false})),
}, {additionalProperties: false});

/**
 * writer 子代理结构化输出。
 */
export const WriterOutputSchema = Type.Object({
    summary: Type.String({description: "写作摘要，说明时间、地点、参与角色、关键动作、关系变化和伏笔/状态变化。"}),
    outputPath: Type.Optional(Type.String({description: "实际写入或修改的文件路径。没有文件落点时不要填。"})),
});

/**
 * retrieval 子代理输入。
 */
export const RetrievalInitialSchema = Type.Object({
    prompt: Type.String({description: "检索请求。写清任务目标、要找什么、给谁用、章节/正文上下文、排除项和数量偏好。"}),
});

/**
 * retrieval 子代理输出：面向 Leader 的内容节点候选判断结果。
 */
export const RetrievalOutputSchema = Type.Object({
    entries: Type.Array(Type.Object({
        path: Type.String({description: "内容节点路径。Leader 调 writer 时只提取这个 path。"}),
        reason: Type.String({description: "为什么这个节点应该传给 writer。按当前写作任务概括，不要完整复述节点 summary。"}),
        use: Type.Optional(Type.String({description: "建议 writer 重点使用这个节点的哪一部分信息；给 Leader 判断用，不直接传给 writer。"})),
        risk: Type.Optional(Type.String({description: "可选风险说明，例如只是弱相关、状态可能过时、需要用户确认、可能与任务冲突。"})),
    }), {description: "按推荐优先级排序的候选内容节点。"}),
    note: Type.Optional(Type.String({description: "整体检索说明，例如没有强相关条目、结果偏少、建议补充搜索条件。"})),
});

/**
 * researcher 子代理输入：创建 session 时传入长期研究边界；每轮具体问题通过 invoke_agent.message 继续对话。
 */
export const ResearcherInitialSchema = Type.Object({
    topic: Type.Optional(Type.String({
        maxLength: 500,
        description: "Long-lived research topic for this researcher session. Omit for a general researcher.",
    })),
    goal: Type.Optional(Type.String({
        maxLength: 1200,
        description: "Stable research goal or operating brief for this researcher session. Per-turn questions should be sent via invoke_agent.message, not stored here.",
    })),
    allowed_domains: Type.Optional(Type.Array(Type.String({
        minLength: 1,
        description: "Default allowed domain filter inherited by web_search unless the turn asks otherwise.",
    }), {maxItems: 20})),
    blocked_domains: Type.Optional(Type.Array(Type.String({
        minLength: 1,
        description: "Default blocked domain filter inherited by web_search unless the turn asks otherwise.",
    }), {maxItems: 50})),
    default_recency_days: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: 3650,
        description: "Default freshness preference for web_search. Omit for no default recency filter.",
    })),
    source_policy: Type.Optional(Type.Union([
        Type.Literal("balanced"),
        Type.Literal("primary_sources"),
        Type.Literal("recent_first"),
    ], {
        description: "Default source preference. primary_sources means prefer official docs, papers, laws, specs, or original announcements when available.",
    })),
    output_language: Type.Optional(Type.String({
        description: "Preferred response language, for example zh-CN or en. Default follows the caller/user language.",
    })),
});
