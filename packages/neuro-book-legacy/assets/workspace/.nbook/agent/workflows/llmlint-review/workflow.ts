/**
 * 内置 workflow：llmlint 审稿（检测 + 报告）。
 *
 * 用 leader.default agent 作为 CLI 执行器（workflow 求值环境禁止 import/fs，adhoc 无 bash），
 * 逐文件并行跑 llmlint check + detect，落盘 JSON 到轮目录，再跑 llmlint report 合成审稿报告。
 *
 * 调用前建议先 `llmlint round begin <files>` 拿到轮号，把轮目录传给 roundDir；
 * 不传时默认落 `.agent/llmlint/review/`（多轮会覆盖，长期谱系请用轮目录）。
 */

export default {
    key: "llmlint-review",
    title: "llmlint 审稿",
    description: "对文件并行执行 llmlint check + detect（AIGC 热力图），落盘 JSON 并合成审稿报告（静态分级 + 密度指纹 + 四象限交叉）。",
    whenToUse: "用户要对章节/正文做 llmlint 审稿、想要一次拿到静态规则命中 + 神经检测热区 + 四象限报告时；只想查单条规则、或正文尚未成稿时不要使用。",
    argsHint: [
        {name: "files", label: "待审文件（Project Workspace 相对路径，多个用逗号分隔）", defaultValue: "manuscript/002-volume/001-chapter/index.md"},
        {name: "skillRoot", label: "llmlint skill 根路径（SkillCatalog 提供）", defaultValue: ""},
        {name: "roundDir", label: "JSON 落盘目录（建议传 llmlint round begin 的轮目录）", defaultValue: ".agent/llmlint/review"},
        {name: "review", label: "审查受众桶：all（创作类默认）或 agent", defaultValue: "all"},
        {name: "skipDetect", label: "跳过神经检测（正文不离机时用）", defaultValue: "false"},
        {name: "concurrency", label: "并行文件数（detect 是外部服务，默认 2）", defaultValue: "2"},
    ],
    phases: [
        {key: "scan", title: "并行 check + detect"},
        {key: "report", title: "合成审稿报告"},
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

        // basename：与 llmlint round 的快照口径一致（含扩展名），仅用于拼输出文件名。
        const baseName = (file: string): string => file.split(/[\\/]/u).filter(Boolean).at(-1) ?? "input.md";

        wf.progress({phase: "scan", done: 0, total: files.length});
        wf.chart.node("scan", "并行 check + detect");
        wf.chart.enter("scan");

        // 单个 CLI 执行器：leader.default 有 bash（adhoc 只有 read），initial 无字段。
        const runner = await wf.agents.create("leader.default", {
            initial: {},
            ephemeral: true,
            tags: ["workflow:llmlint-review", "role:clirunner"],
        });

        const results = await wf.map(files, async (file) => {
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
                `if [ -s "${checkPath}" ]${skipDetect ? "" : ` && [ -s "${detectPath}" ]`}; then`,
                `  bun "${skillRoot}/bin/llmlint.ts" report --check "${checkPath}"${skipDetect ? "" : ` --detect "${detectPath}"`};`,
                "else",
                `  echo "REPORT_SKIPPED"; cat "${checkPath}" 2>/dev/null | head -c 300;`,
                "fi",
            ].filter((line) => line !== "").join("\n");
            const outcome = await runner.invoke({
                mode: "prompt",
                message: [
                    `用 bash 执行下面这条命令，只把命令的原始 stdout 回报给我（不要总结、不要加任何额外解释，命令本身不用回报）：`,
                    "```bash",
                    command,
                    "```",
                    "注意事项：命令会依次跑 check、detect（可能因外部服务失败）、report；每个文件的 JSON 已重定向落盘，stdout 里主要是 report 的 markdown 或失败提示。",
                ].join("\n"),
            });
            if (outcome.status !== "completed") {
                throw new Error(`文件 ${file} 的 llmlint 执行未完成：${outcome.result.message}`);
            }
            const reportText = outcome.result.message ?? "";
            const detectFailed = !skipDetect && !reportText.includes("DETECT_EXIT=0");
            return {file, checkJson: checkPath, detectJson: skipDetect ? null : detectPath, detectFailed, report: reportText};
        }, {concurrency});

        wf.chart.leave("scan");
        wf.progress({phase: "scan", done: files.length, total: files.length});

        wf.progress({phase: "report", done: 1, total: 1});
        wf.chart.node("report", "汇总报告");
        wf.chart.enter("report");

        const reports = results.map((r) => {
            const header = `## ${r.file}${r.detectFailed ? "（detect 失败，仅静态部分）" : ""}\n\n`;
            const body = r.report.replace(/^# llmlint 审稿报告\n/u, "").replace(/^## /gmu, "### ");
            return header + body;
        });

        const failedDetect = results.filter((r) => r.detectFailed).map((r) => r.file);
        wf.log(`llmlint 审稿完成：${files.length} 个文件${skipDetect ? "（跳过 detect）" : failedDetect.length > 0 ? `，${failedDetect.length} 个 detect 失败` : ""}`);

        wf.chart.leave("report");
        return {
            files: results.map((r) => ({file: r.file, checkJson: r.checkJson, detectJson: r.detectJson, detectFailed: r.detectFailed})),
            failedDetect,
            report: reports.join("\n\n"),
            review,
            skipDetect,
            roundDir,
        };
    },
};
