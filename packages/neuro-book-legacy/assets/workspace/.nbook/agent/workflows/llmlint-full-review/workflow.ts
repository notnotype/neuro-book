/**
 * 内置 workflow：llmlint 完整审稿（检测 → 报告 → 计划 → 审批 → 修复 → 复测）。
 *
 * 在 llmlint-review 基础上加四步：
 *   - plan：runner（leader.default）读报告 + 命中 JSON + 原文，注入 guide 约束，按「修 / 留 / 问」生成 plan.md（含激进档决定）
 *   - 审批：wf.ask（approve）让用户在 workflow 面板批准修复计划；拒绝则提前结束
 *   - fix：adhoc 修复员（只有 read+report_result，无 write 天然不越权）按 plan+guide 重写，返回全文由 runner 落盘 output/
 *   - retest：复测 check/detect + round metrics 算 verdict（pass/fail）
 *
 * 调用前先 `llmlint round begin <files>` 拿轮号，把轮目录传 roundDir（谱系完整）。
 */

export default {
    key: "llmlint-full-review",
    title: "llmlint 完整审稿",
    description: "对文件执行 llmlint 检测 + 报告 + 修复计划（注入 guide 约束）+ 人工审批 + adhoc 修复 + 复测闭环，返回修后稿路径与复测 verdict。",
    whenToUse: "用户要对正文做完整 llmlint 审稿并直接修到轮目录（含计划审批和复测判据）时；只想先看报告不修复（用 llmlint-review）、或正文尚未成稿时不要使用。",
    argsHint: [
        {name: "files", label: "待审文件（Project Workspace 相对路径，多个用逗号分隔）", defaultValue: "manuscript/002-volume/001-chapter/index.md"},
        {name: "skillRoot", label: "llmlint skill 根路径（SkillCatalog 提供）", defaultValue: ""},
        {name: "roundDir", label: "轮目录（建议先 llmlint round begin 拿到）", defaultValue: ".agent/llmlint/review"},
        {name: "review", label: "审查受众桶：all（创作类默认）或 agent", defaultValue: "all"},
        {name: "skipDetect", label: "跳过神经检测（正文不离机时用）", defaultValue: "false"},
        {name: "concurrency", label: "并行文件数（默认 2）", defaultValue: "2"},
        {name: "aggressiveness", label: "修复激进档：balanced / aggressive / auto（auto 由 plan 生成器根据报告自主决定）", defaultValue: "auto"},
    ],
    phases: [
        {key: "scan", title: "并行 check + detect"},
        {key: "report", title: "合成审稿报告"},
        {key: "plan", title: "生成修复计划"},
        {key: "approve", title: "人工审批计划"},
        {key: "fix", title: "按计划修复"},
        {key: "integrity", title: "原文件完整性校验"},
        {key: "retest", title: "复测与 verdict"},
    ],
    run: async (wf, args) => {
        const skillRoot = typeof args?.skillRoot === "string" && args.skillRoot.trim()
            ? args.skillRoot.trim()
            : "";
        if (!skillRoot) {
            throw new Error("缺少 skillRoot：llmlint skill 根路径（SkillCatalog 里 llmlint 的 root 字段）");
        }
        const rawFiles = Array.isArray(args?.files)
            ? args.files.filter((f) => typeof f === "string" && f.trim().length > 0).map((f) => f.trim())
            : typeof args?.files === "string" && args.files.trim()
                ? args.files.split(",").map((f) => f.trim()).filter(Boolean)
                : [];
        if (rawFiles.length === 0) {
            throw new Error("缺少 files：至少一个 Project Workspace 相对路径");
        }
        const files = [...new Set(rawFiles)];
        const roundDir = typeof args?.roundDir === "string" && args.roundDir.trim()
            ? args.roundDir.trim()
            : ".agent/llmlint/review";
        const review = args?.review === "agent" ? "agent" : "all";
        const skipDetect = args?.skipDetect === true || args?.skipDetect === "true";
        const concurrency = Math.max(1, Math.min(Math.floor(Number(args?.concurrency) || 2), 4));
        // 修复激进档：auto 时由 plan 生成器读报告自主决定（规则见 plan 步骤）；
        // balanced 保守只修无功能负担项；aggressive 允许按 guide 重写并给关键规则目标值。
        const aggressiveness = args?.aggressiveness === "aggressive"
            ? "aggressive"
            : args?.aggressiveness === "balanced" ? "balanced" : "auto";

        const baseName = (file: string): string => file.split(/[\\/]/u).filter(Boolean).at(-1) ?? "input.md";
        // 从轮目录末段提取轮号（.agent/llmlint/rounds/0001 → 1）；非标准轮目录时返回 null
        const roundMatch = /rounds\/(\d+)\/?$/u.exec(roundDir);
        const roundNumber = roundMatch ? Number.parseInt(roundMatch[1], 10) : null;

        // 单个 CLI 执行器：leader.default 有 bash（adhoc 只有 read），initial 无字段。
        const runner = await wf.agents.create("leader.default", {
            initial: {},
            ephemeral: true,
            tags: ["workflow:llmlint-full-review", "role:clirunner"],
        });
        const runCommand = (command: string) => runner.invoke({
            mode: "prompt",
            message: [
                "用 bash 执行下面这条命令，只把命令的原始 stdout 回报给我（不要加任何额外解释、不要总结）：",
                "```bash",
                command,
                "```",
            ].join("\n"),
        });

        // 1. 并行 check + detect
        wf.progress({phase: "scan", done: 0, total: files.length});
        wf.chart.node("scan", "并行 check + detect");
        wf.chart.enter("scan");
        const scanResults = await wf.map(files, async (file) => {
            const base = baseName(file);
            // 单文件用 llmlint round 标准命名（check-source.json / detect-source.json），
            // 让 round metrics / contribute 能直接读；多文件才用带 basename 的命名。
            const single = files.length === 1;
            const checkPath = single ? `${roundDir}/check-source.json` : `${roundDir}/check-${base}.json`;
            const detectPath = single ? `${roundDir}/detect-source.json` : `${roundDir}/detect-${base}.json`;
            const detectPart = skipDetect ? "" : `\nbun "${skillRoot}/bin/llmlint.ts" detect "${file}" --format json > "${detectPath}" 2>&1; ec2=$?; echo "DETECT_EXIT=$ec2";`;
            const command = [
                `mkdir -p "${roundDir}"`,
                `bun "${skillRoot}/bin/llmlint.ts" check "${file}" --review ${review} --format json > "${checkPath}" 2>&1; ec1=$?; echo "CHECK_EXIT=$ec1";`,
                detectPart,
                `[ -s "${checkPath}" ] && echo "CHECK_OK" || echo "CHECK_FAIL"`,
                `[ -s "${detectPath}" ] && echo "DETECT_OK" || echo "DETECT_FAIL"`,
            ].filter((line) => line !== "").join("\n");
            const outcome = await runCommand(command);
            if (outcome.status !== "completed") {
                throw new Error(`文件 ${file} 的 llmlint 执行未完成：${outcome.result.message}`);
            }
            const text = outcome.result.message ?? "";
            return {
                file, base, checkPath, detectPath,
                checkOk: text.includes("CHECK_OK"),
                detectOk: skipDetect || text.includes("DETECT_OK"),
            };
        }, {concurrency});
        wf.chart.leave("scan");
        wf.progress({phase: "scan", done: files.length, total: files.length});

        // 2. 合成报告（逐文件；detect 失败或跳过的文件只给静态部分）
        wf.progress({phase: "report", done: 0, total: files.length});
        wf.chart.node("report", "合成审稿报告");
        wf.chart.enter("report");
        const reports: string[] = [];
        for (const r of scanResults) {
            if (!r.checkOk) {
                reports.push(`## ${r.file}\n\n（check 失败，跳过）`);
                continue;
            }
            const detectArg = r.detectOk ? ` --detect "${r.detectPath}"` : "";
            const outcome = await runCommand(
                `bun "${skillRoot}/bin/llmlint.ts" report --check "${r.checkPath}"${detectArg}`,
            );
            if (outcome.status !== "completed") {
                reports.push(`## ${r.file}\n\n（report 失败：${outcome.result.message}）`);
                continue;
            }
            const body = (outcome.result.message ?? "")
                .replace(/^# llmlint 审稿报告\n/u, "")
                .replace(/^## /gmu, "### ")
                .replace(/^```[\s\S]*?```\n?/u, "");
            reports.push(`## ${r.file}\n\n${body.trim()}`);
        }
        const reportText = reports.join("\n\n");
        wf.chart.leave("report");
        wf.progress({phase: "report", done: files.length, total: files.length});

        // 3. 生成 plan.md（runner 读报告 + 命中 + 原文，注入 guide 约束，按修/留/问分流）
        //    先取 guide 摘要：语义规则（静态查不到）必须由模型读过才有执行路径。
        wf.progress({phase: "plan", done: 1, total: 1});
        wf.chart.node("plan", "生成修复计划");
        wf.chart.enter("plan");
        const guideOutcome = await runCommand(`bun "${skillRoot}/bin/llmlint.ts" guide --tier standard`);
        const guideRaw = guideOutcome.result.message ?? "";
        const guideText = guideRaw.includes("# 中文正文写作约束要点")
            ? guideRaw.slice(guideRaw.indexOf("# 中文正文写作约束要点"))
            : guideRaw;
        const firstCheck = scanResults.find((r) => r.checkOk)?.checkPath ?? null;
        const planOutcome = await runner.invoke({
            mode: "prompt",
            message: [
                "你是 llmlint 审稿流程的修复计划生成器。根据审稿报告、命中 JSON 和原文，生成修复计划文件。",
                "要求：",
                "1. 用 read 工具读：审稿报告（见下）、check JSON、detect JSON（若有）、原文文件。",
                "2. 计划按「修 / 留 / 问」三档分流：修=确认无功能的模板负担（给最小改法）；留=承担剧情/人物声音/节奏功能（给保留理由）；问=证据不足或改作者意图（交用户）。",
                "3. 每项引用行号、原文片段、修复理由。统计摘要（静态命中分级、密度指纹、docPAi/spread、四象限结论）放最前。",
                "4. 硬伤必须逐字扫描原文（不要只看规则命中）：错别字（如「我了在原地」→「我愣在原地」）、草稿残留（如「薇洛丝（男）」这类括号注释）、语法错误（如「不觉得那是安全」→「不觉得那是安全的」）。全部单列一组，标「必须修」，给行号和最小改法。",
                "5. 篇幅预算：删减不超过两成（visibleChars 口径），不要为了清零命中而大删。",
                `6. 用 write 工具把计划写到：${roundDir}/plan.md`,
                "",
                `档位决策（aggressiveness = ${aggressiveness}）：`,
                "- balanced：保守。只修明确无功能负担的命中；承担角色声音/节奏的判「留」。",
                "- aggressive：允许按 guide 重写模板化表达（不只删压换）；关键规则给目标值——not-is-comparison 修 ≥50%、开头 150 字内不允许连续否定对比、语义规则全部对照。",
                `- auto：你根据审稿报告自主决定。触发 aggressive 的条件：confirm 象限 ≥3 处，或 not-is-comparison 命中 ≥30，或开头 600 字内连续否定对比 ≥2 处；否则 balanced。把决定写进 plan.md 头部（「档位：X（理由：…）」）。`,
                "",
                "写作约束（guide；判「修/留/问」和给改法时对照，尤其「优先注意：静态工具查不出来的」段与「不是A，是B 对比状态机」条）：",
                guideText,
                "",
                `审稿报告：\n${reportText}`,
                firstCheck ? `check JSON 路径：${firstCheck}` : "",
            ].join("\n"),
        });
        if (planOutcome.status !== "completed") {
            throw new Error(`plan.md 生成未完成：${planOutcome.result.message}`);
        }
        wf.chart.leave("plan");

        // 4. 人工审批（approve：用户在 workflow 面板批准 / 拒绝）
        wf.progress({phase: "approve", done: 1, total: 1});
        wf.chart.node("approve", "审批修复计划");
        wf.chart.enter("approve");
        const approved = await wf.ask({
            kind: "approve",
            title: "批准 llmlint 修复计划？",
        });
        wf.chart.leave("approve");
        if (approved !== true) {
            wf.log("用户拒绝修复计划，workflow 提前结束，plan.md 已保留在轮目录");
            return {
                status: "rejected",
                planPath: `${roundDir}/plan.md`,
                report: reportText,
                files: scanResults.map((r) => ({file: r.file, checkJson: r.checkPath, detectJson: r.detectPath, detectOk: r.detectOk})),
            };
        }

        // 5. 编辑指令修复：runner 读原文 → workflow 按 ## 分块 → 每块 adhoc 生成结构化编辑指令
        //    （{original→replacement}，flash 模型稳定输出的形式）→ 合并 → runner 脚本精确应用。
        //    不再要求模型输出完整全文（实测 flash 系统性只出摘要）；脚本应用保证原文其余部分原样保留。
        wf.progress({phase: "fix", done: 0, total: files.length});
        wf.chart.node("fix", "编辑指令修复");
        wf.chart.enter("fix");
        const EditSchema = Type.Object({
            edits: Type.Array(Type.Object({
                original: Type.String({description: "原文片段：必须在所给块原文中恰好出现一次（唯一匹配）；拿不准就多带上下文词"}),
                replacement: Type.String({description: "替换文本；删除时为空字符串"}),
                note: Type.String({description: "规则 id 或硬伤类型 + 一句理由"}),
            }, {additionalProperties: false})),
            summary: Type.String({description: "改动总览一句话"}),
        }, {additionalProperties: false});
        // 应用脚本（runner 用 node 执行）：逐条唯一匹配替换，非唯一/缺失进 failed，不静默错改。
        const APPLY_SCRIPT = [
            "const fs = require(\"fs\");",
            "const [,, src, editsPath, out] = process.argv;",
            "const edits = JSON.parse(fs.readFileSync(editsPath, \"utf8\")).edits;",
            "let t = fs.readFileSync(src, \"utf8\");",
            "const applied = [], failed = [];",
            "for (const e of edits) {",
            "  const esc = e.original.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\");",
            "  const matches = [...t.matchAll(new RegExp(esc, \"g\"))];",
            "  if (matches.length !== 1) {",
            "    failed.push((e.note || \"\") + \"|match\" + matches.length + \"|\" + e.original.slice(0, 30));",
            "    continue;",
            "  }",
            "  const i = matches[0].index;",
            "  t = t.slice(0, i) + e.replacement + t.slice(i + e.original.length);",
            "  applied.push(e.note || \"\");",
            "}",
            "fs.writeFileSync(out, t);",
            "console.log(\"APPLIED=\" + applied.length + \" FAILED=\" + failed.length);",
            "if (failed.length) console.log(\"FAILED_DETAIL=\" + JSON.stringify(failed));",
        ].join("\n");
        const fixResults = await wf.map(scanResults, async (r) => {
            if (!r.checkOk) {
                return {file: r.file, outputPath: null, skipped: true};
            }
            const outputPath = `${roundDir}/output/${r.base}`;
            // runner 用 bash cat 读原文（read 工具会带行号前缀污染分块）
            const readOutcome = await runCommand(`cat "${r.file}"`);
            if (readOutcome.status !== "completed") {
                return {file: r.file, outputPath, skipped: false, error: `读原文失败：${readOutcome.result.message}`};
            }
            const fullText = readOutcome.result.message ?? "";
            if (fullText.trim().length < 5000) {
                return {file: r.file, outputPath, skipped: false, error: `原文读取不完整（${fullText.trim().length} 字符）`};
            }

            // 按 "## " 标题分块；frontmatter 与首个标题前内容原样保留（不参与修复）
            const lines = fullText.split("\n");
            const titleIdx: number[] = [];
            lines.forEach((line, index) => {
                if (/^##\s/u.test(line)) titleIdx.push(index);
            });
            const chunks: Array<{title: string; startLine: number; endLine: number; text: string}> = [];
            if (titleIdx.length === 0) {
                chunks.push({title: "全文", startLine: 1, endLine: lines.length, text: fullText});
            } else {
                for (let k = 0; k < titleIdx.length; k++) {
                    const start = titleIdx[k]!;
                    const end = k + 1 < titleIdx.length ? titleIdx[k + 1]! : lines.length;
                    chunks.push({
                        title: lines[start]!.replace(/^##\s*/u, "").slice(0, 20),
                        startLine: start + 1,
                        endLine: end,
                        text: lines.slice(start, end).join("\n"),
                    });
                }
            }

            // 逐块生成编辑指令
            const allEdits: Array<{original: string; replacement: string; note: string}> = [];
            for (const chunk of chunks) {
                const fixer = await wf.agents.create("adhoc", {
                    initial: {
                        name: "llmlint 编辑指令生成员",
                        systemPrompt: "你是中文小说正文修复员。按修复计划与写作约束，对指定的一块正文输出结构化编辑指令（原文片段→替换文本）。只改表达，不改剧情、人设、时间线、叙事视角；对白保留角色声音；不新增原文没有的事件。",
                        outputSchema: EditSchema,
                    },
                    ephemeral: true,
                    tags: ["workflow:llmlint-full-review", "role:fixer", `file:${r.base}`, `chunk:${chunk.title}`],
                });
                const outcome = await fixer.invoke({
                    mode: "prompt",
                    message: [
                        `对「${chunk.title}」这一节（对应全文 L${chunk.startLine}-L${chunk.endLine}）生成 llmlint 编辑指令。`,
                        "",
                        "步骤：",
                        `1. 用 read 工具读修复计划：${roundDir}/plan.md（档位写在头部；行号是全文件行号，只处理落在 L${chunk.startLine}-L${chunk.endLine} 范围内的「修」组与「必须修」条目；「留」「问」组一律不动）。`,
                        "2. 对照下面【本块原文】，逐条生成编辑指令。",
                        "3. report_result.data 返回 {edits, summary}：",
                        "   edits 每项：",
                        "   - original：原文片段。**必须在【本块原文】中恰好出现一次**（唯一匹配）；拿不准就多带前后几个字确保唯一；禁止用「完全」「一种」「频率」这类孤立短词；只改这一块的原文，不要包含本块之外的文字。",
                        "   - replacement：替换文本；删除时为空字符串。",
                        "   - note：规则 id（如 story-deslop.not-is-comparison）或硬伤类型 + 一句理由。",
                        "   summary：改动总览一句话。",
                        "",
                        "【本块原文】",
                        chunk.text,
                        "",
                        "修复纪律：",
                        "- 只改表达，不改剧情、人设、时间线、叙事视角；不新增原文没有的事件。",
                        "- 按「删 → 压 → 换」处理；篇幅删减不超过两成。",
                        "- 对白保留角色声音；拿不准的归「问」，不要擅改。",
                        "",
                        "写作约束（guide，逐条对照；plan 档位为 aggressive 时允许按它重写模板化表达，不只删压换）：",
                        guideText,
                    ].join("\n"),
                });
                if (outcome.status !== "completed") {
                    return {file: r.file, outputPath, skipped: false, error: `块「${chunk.title}」指令生成未完成：${outcome.result.message}`};
                }
                const data = outcome.result.data as {edits?: Array<{original?: string; replacement?: string; note?: string}>; summary?: string} | null;
                if (!data || !Array.isArray(data.edits) || data.edits.length === 0) {
                    // 空 edits 合法（该块无修组命中），继续下一块
                    continue;
                }
                for (const e of data.edits) {
                    if (typeof e?.original === "string" && e.original.trim().length > 0 && typeof e.replacement === "string") {
                        allEdits.push({original: e.original, replacement: e.replacement, note: e.note ?? ""});
                    }
                }
            }

            if (allEdits.length === 0) {
                return {file: r.file, outputPath, skipped: false, error: "所有块都未生成编辑指令（plan 修组可能为空或生成失败）"};
            }

            // runner 写 edits JSON + apply 脚本，然后 node 应用
            const editsPath = `${roundDir}/edits-${r.base}.json`;
            // .cjs：项目位于 type:module 环境，.js 会被当 ESM（require 不可用）
            const applyPath = `${roundDir}/apply-edits.cjs`;
            const editsJson = JSON.stringify({edits: allEdits});
            const writeEdits = await runner.invoke({
                mode: "prompt",
                message: [`用 write 工具把下面这份 JSON 写到 ${editsPath}：\n\n${editsJson}`],
            });
            if (writeEdits.status !== "completed") {
                return {file: r.file, outputPath, skipped: false, error: `写 edits JSON 失败：${writeEdits.result.message}`};
            }
            const writeScript = await runner.invoke({
                mode: "prompt",
                message: [`用 write 工具把下面这份 Node 脚本写到 ${applyPath}：\n\n${APPLY_SCRIPT}`],
            });
            if (writeScript.status !== "completed") {
                return {file: r.file, outputPath, skipped: false, error: `写 apply 脚本失败：${writeScript.result.message}`};
            }
            const applyOutcome = await runCommand(`node "${applyPath}" "${r.file}" "${editsPath}" "${outputPath}"`);
            if (applyOutcome.status !== "completed") {
                return {file: r.file, outputPath, skipped: false, error: `应用指令失败：${applyOutcome.result.message}`};
            }
            const applyText = applyOutcome.result.message ?? "";
            const appliedMatch = applyText.match(/APPLIED=(\d+)/u);
            const failedMatch = applyText.match(/FAILED=(\d+)/u);
            const applied = appliedMatch ? Number.parseInt(appliedMatch[1], 10) : 0;
            const failed = failedMatch ? Number.parseInt(failedMatch[1], 10) : -1;
            if (failed > 0 || applied === 0) {
                const detail = applyText.match(/FAILED_DETAIL=([\s\S]*)$/u)?.[1] ?? "";
                return {file: r.file, outputPath, skipped: false, error: `应用指令失败（applied=${applied} failed=${failed}）：${detail.slice(0, 300)}`};
            }
            return {file: r.file, outputPath, skipped: false, applied, edits: allEdits.length};
        }, {concurrency});
        wf.chart.leave("fix");
        wf.progress({phase: "fix", done: files.length, total: files.length});

        // 6. 原文件完整性校验：若修复阶段仍意外改到原文件，从快照强制回滚。
        //    修复员本身无 write 权限（天然不越权），这里只兜底 runner 或外部改动。
        wf.progress({phase: "integrity", done: 0, total: files.length});
        wf.chart.node("integrity", "校验原文件未被越权修改");
        wf.chart.enter("integrity");
        const integrity = await wf.map(scanResults, async (r) => {
            const snapshot = `${roundDir}/source/${r.base}`;
            const outcome = await runCommand(
                `if cmp -s "${r.file}" "${snapshot}"; then echo "ORIGINAL_INTACT"; else cp "${snapshot}" "${r.file}" && echo "ORIGINAL_RESTORED"; fi`,
            );
            const text = outcome.result.message ?? "";
            const restored = text.includes("ORIGINAL_RESTORED");
            if (restored) {
                wf.log(`原文件 ${r.file} 被意外修改，已从快照回滚`);
            }
            return {file: r.file, restored};
        }, {concurrency: 1});
        wf.chart.leave("integrity");
        wf.progress({phase: "integrity", done: files.length, total: files.length});

        // 7. 复测 check/detect + round metrics（verdict）
        wf.progress({phase: "retest", done: 0, total: files.length});
        wf.chart.node("retest", "复测与 verdict");
        wf.chart.enter("retest");
        const retests = await wf.map(fixResults, async (r) => {
            if (!r.outputPath || r.skipped || r.error) {
                return {file: r.file, verdict: null, message: r.error ?? "skipped"};
            }
            const outBase = baseName(r.outputPath);
            const checkOut = `${roundDir}/check-output.json`;
            const detectOut = `${roundDir}/detect-output.json`;
            const detectPart = skipDetect ? "" : `\nbun "${skillRoot}/bin/llmlint.ts" detect "${r.outputPath}" --format json > "${detectOut}" 2>&1; echo "DETECT_EXIT=$?";`;
            const command = [
                `bun "${skillRoot}/bin/llmlint.ts" check "${r.outputPath}" --review ${review} --format json > "${checkOut}" 2>&1; echo "CHECK_EXIT=$?";`,
                detectPart,
                `[ -s "${checkOut}" ] && echo "CHECK_OK" || echo "CHECK_FAIL"`,
            ].filter((line) => line !== "").join("\n");
            const outcome = await runCommand(command);
            if (outcome.status !== "completed") {
                return {file: r.file, verdict: null, message: outcome.result.message};
            }
            // verdict：round metrics 需要轮号；非标准轮目录时跳过 verdict，只给 JSON 路径
            if (roundNumber === null) {
                return {file: r.file, verdict: null, checkOutput: checkOut, detectOutput: detectOut};
            }
            const metricsOutcome = await runCommand(
                `bun "${skillRoot}/bin/llmlint.ts" round metrics ${roundNumber} --format json`,
            );
            const metricsText = metricsOutcome.result.message ?? "";
            let metrics: {staticIssues?: number; densityIssues?: number; docPAi?: number; spread?: number; verdict?: string} = {};
            try {
                // runner 可能夹带代码块围栏或解释文字，只提取第一个 { 到最后一个 } 的子串。
                const jsonMatch = metricsText.match(/\{[\s\S]*\}/u);
                if (jsonMatch) {
                    metrics = JSON.parse(jsonMatch[0]) ?? {};
                }
            } catch {
                metrics = {};
            }
            return {file: r.file, verdict: metrics.verdict ?? null, checkOutput: checkOut, detectOutput: detectOut, metrics};
        }, {concurrency});
        wf.chart.leave("retest");
        wf.progress({phase: "retest", done: files.length, total: files.length});

        wf.log(`llmlint 完整审稿完成：${files.length} 个文件${skipDetect ? "（跳过 detect）" : ""}`);
        return {
            status: "completed",
            report: reportText,
            planPath: `${roundDir}/plan.md`,
            integrity,
            fixes: fixResults,
            retests,
        };
    },
};
