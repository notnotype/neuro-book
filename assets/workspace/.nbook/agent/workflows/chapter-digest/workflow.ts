/**
 * 内置 workflow：逐章摘要（整书导入管线）。
 *
 * 读取章节正文 → adhoc 逐章并发生成 {summary, characters, events} → 返回结果。
 * 落盘由 leader 用 `workspace node set-summary --stdin` 批量写回 frontmatter，
 * characters/events 供结构提取复用，不浪费这轮 token。
 * `Type` 由 WorkflowCatalog 求值作用域注入，源码禁止 import。
 */

const ChapterDigestSchema = Type.Object({
    summary: Type.String({description: "本章摘要，一到三句、不换行、建议不超过 120 字。"}),
    characters: Type.Array(Type.String(), {description: "本章实际出场人物名。"}),
    events: Type.Array(Type.String(), {description: "按发生顺序排列的关键事件。"}),
}, {additionalProperties: false});

export default {
    key: "chapter-digest",
    title: "逐章摘要",
    description: "整书导入管线第二步：对 manuscript 章节批量生成摘要与出场人物/关键事件，结果由 leader 写回 frontmatter.summary。",
    whenToUse: "整本书稿已导入 manuscript 需要逐章摘要（导入管线、迁移后索引）；单章细节讨论或用户自己写作中的章节不要使用。",
    argsHint: [
        {name: "chapterPaths", label: "章节目录清单（逗号或换行分隔，从 `workspace node parse` 结果列出）", defaultValue: ""},
        {name: "model", label: "摘要模型 key（建议填便宜模型；留空用默认）", defaultValue: ""},
        {name: "limit", label: "本 run 最多处理章数（默认 30；超出的由 leader 分批循环）", defaultValue: "30"},
    ],
    phases: [
        {key: "collect", title: "读取章节"},
        {key: "digest", title: "逐章并发摘要"},
    ],
    run: async (wf, args) => {
        const rawPaths = typeof args?.chapterPaths === "string" ? args.chapterPaths.trim() : "";
        if (!rawPaths) {
            throw new Error("必须提供 chapterPaths：章节目录清单，逗号或换行分隔。");
        }
        const chapterPaths = rawPaths
            .split(/[,，\n]/u)
            .map((item) => item.trim())
            .filter(Boolean);
        const model = typeof args?.model === "string" && args.model.trim() ? args.model.trim() : undefined;
        const limit = Math.max(1, Math.min(Math.floor(Number(args?.limit) || 30), 60));

        wf.progress({phase: "collect"});
        wf.chart.node("collect", "读取章节");
        wf.chart.enter("collect");

        const selected = chapterPaths.slice(0, limit);
        const chapters = [];
        for (const chapterPath of selected) {
            let text = "";
            try {
                // node parse 输出的路径是内容节点目录；目录自动补 index.md，单文件原样读
                const readPath = chapterPath.endsWith(".md") ? chapterPath : `${chapterPath}/index.md`;
                text = await wf.workspace.read(readPath);
            } catch (error) {
                throw new Error(`章节读取失败：${chapterPath}（${error instanceof Error ? error.message : String(error)}）`);
            }
            const lines = text.split("\n");
            const heading = (lines[0] || "").replace(/^#+\s*/u, "").trim().slice(0, 60) || chapterPath;
            chapters.push({path: chapterPath, heading, text});
        }
        if (chapters.length === 0) {
            throw new Error("没有可处理的章节");
        }
        wf.log(`读取 ${chapters.length} 章${chapters.length < chapterPaths.length ? `（共 ${chapterPaths.length} 条，本 run 上限 ${limit}，余下由 leader 循环）` : ""}`);

        wf.progress({phase: "digest", done: 0, total: chapters.length});
        let completed = 0;
        const digests = await wf.map(chapters, async (chapter) => {
            const token = `chapter-${chapter.path}`;
            const nodeKey = `digest-${token}`;
            const agent = await wf.agents.create("adhoc", {
                initial: {
                    name: "章节摘要员",
                    systemPrompt: "你只分析调用方提供的小说章节正文，准确提取摘要、出场人物和关键事件，不补写正文中不存在的信息。完成后必须用 report_result 返回结构化 data。",
                    outputSchema: ChapterDigestSchema,
                },
                ...(model ? {model} : {}),
                ephemeral: true,
                tags: ["workflow:chapter-digest", token],
            });
            wf.chart.node(nodeKey, `${chapter.heading}`);
            wf.chart.edge("collect", nodeKey, "派发");
            wf.chart.enter(nodeKey, {token, sessionId: agent.id});
            const response = await agent.invoke({
                message: [
                    `分析章节「${chapter.heading}」，按已声明 schema 汇报摘要（一到三句）、出场人物与关键事件。`,
                    "",
                    chapter.text.slice(0, 8000),
                ].join("\n"),
            });
            if (response.status !== "completed") throw new Error(`章节「${chapter.heading}」摘要未完成：${response.result.message}`);
            const digest = response.result.data;
            if (!digest || typeof digest !== "object" || Array.isArray(digest)) {
                throw new Error(`章节「${chapter.heading}」未按 outputSchema 返回 report_result.data`);
            }
            if (typeof digest.summary !== "string" || !Array.isArray(digest.characters) || !Array.isArray(digest.events)) {
                throw new Error(`章节「${chapter.heading}」摘要结果缺少 summary/characters/events 关键字段`);
            }
            wf.chart.leave(nodeKey, {token});
            wf.progress({phase: "digest", done: ++completed, total: chapters.length});
            return {path: chapter.path, heading: chapter.heading, digest};
        }, {concurrency: 3});

        wf.chart.node("finish", "完成");
        wf.chart.move("collect", "finish", {label: "产出"});
        wf.chart.leave("finish");
        wf.log(`逐章摘要完成：${digests.length} 章`);
        return {
            processed: digests.length,
            totalListed: chapterPaths.length,
            digests: digests.map((entry) => ({
                path: entry.path,
                heading: entry.heading,
                summary: entry.digest.summary,
                characters: entry.digest.characters,
                events: entry.digest.events,
            })),
        };
    },
};
