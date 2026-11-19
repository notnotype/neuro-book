import {createHash} from "node:crypto";
import {mkdir, readFile, rm} from "node:fs/promises";
import {unzipSync} from "fflate";

/**
 * V7 纯 brief 生成脚本（Task 00161）
 *
 * 生成链：
 *   1. 读取冻结提示词 `brief-only-prompt-v7-repaired-v4.md` 与已接受底稿 `ingest-v4.md`；
 *   2. 单次官方 POST /chat/completions（deepseek/deepseek-v4-flash，零重试）；
 *   3. 严格单候选非空即视为成功，来源连续 8 字重合只记录诊断不拒绝；
 *   4. 候选先写系统临时根，再保存正式 brief 与脱敏 stats。
 *
 * 正式产物 `chapter-001-summary-level-2-brief-only-v7-final.md` 由本脚本的模型候选
 * 经宿主确定性事实归属修订（炸毛原因、触感归属、星界使者主语、中性化"侵占"表述）
 * 与零重合扫描后得到；本脚本复现其中的模型生成与扫描部分。
 *
 * 隐私边界：原文只在宿主内存中用于扫描，不发送给模型；密钥从本机配置读取，
 * 不持久化 header、响应封套或候选正文。
 */
const root = "C:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book";
const temp = "C:/Users/USER~1/AppData/Local/Temp/neuro-book/runs/00161-novel-understanding-spike/summary-v7-brief-only";
const paths = {
    config: "C:/Users/<user>/AppData/Local/NeuroBook/data/workspace/.nbook/config.json",
    epub: `${root}/.local/novels/转生反派萝莉，找茬魔法少女.epub`,
    prompt: `${root}/.agents/works/w00005-novel-understanding-spike/tasks/t01-novel-understanding-spike/evidences/chapter-001-summary-level-2-brief-only-prompt-v7-repaired-v4.md`,
    referenceBrief: `${root}/.agents/works/w00005-novel-understanding-spike/tasks/t01-novel-understanding-spike/evidences/chapter-001-summary-level-2-ingest-v4.md`,
    brief: `${root}/.agents/works/w00005-novel-understanding-spike/tasks/t01-novel-understanding-spike/evidences/chapter-001-summary-level-2-brief-only-v7-final.md`,
    stats: `${root}/.agents/works/w00005-novel-understanding-spike/tasks/t01-novel-understanding-spike/evidences/chapter-001-summary-level-2-brief-only-v7-final-official-call-stats.json`,
    candidate: `${temp}/candidate-v7-final.md`,
} as const;

const contract = {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    purpose: "chapter-001-summary-level-2-brief-only-v7-final-official",
    version: "chapter-summary-level-2-brief-only/v7-repaired-v4",
    maxTokens: 4000,
    member: "OEBPS/chapter_00001.xhtml",
    promptFileSha256: "085dc04553e4b6c1531e48a293a497c71b2e8e0e5ff4206f9a8aea11e9f97c4a",
    systemSha256: "94768eaef3e085cf5514aa9070c49117d5b8052cd858c5b052b07f22df53f7fc",
    userTemplateSha256: "c59901c9f2c64fbbb0fc9dd413b08a0e12e9e1bfa5f0e1033799f08548c80ea2",
    referenceBriefSha256: "c34d293aeb102881c50ebd1dedcba968947955d3c6878060f006de4d83814808",
    sourceSha256: "22c9b12d0305da4b64ea39751e809ed47cf9254d574caf875fbff91ef82552ee",
} as const;

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const visible = (value: string) => value.replace(/\s/gu, "");
const check = (condition: unknown, message: string): asserts condition => {
    if (!condition) throw new Error(message);
};

function decodeEntities(value: string): string {
    const named: Record<string, string> = {amp: "&", apos: "'", gt: ">", lt: "<", nbsp: "\u00a0", quot: "\""};
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, key: string) => {
        if (/^#x/iu.test(key)) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
        if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
        return named[key.toLowerCase()] ?? entity;
    });
}

function sourceText(html: string): string {
    return decodeEntities(html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "")
        .replace(/<br\s*\/?>/giu, "\n")
        .replace(/<\/(?:p|div|h[1-6])\s*>/giu, "\n")
        .replace(/<[^>]+>/gu, ""))
        .split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).join("\n");
}

function detectSourceLeaks(brief: string, source: string) {
    const briefVisible = visible(brief);
    const sourceVisible = visible(source);
    const leaks: Array<{briefVisibleStart: number; briefVisibleEnd: number; sourceVisibleStart: number; sourceVisibleEnd: number; matchVisibleChars: number; matchSha256: string}> = [];
    for (let i = 0; i <= briefVisible.length - 8;) {
        const j = sourceVisible.indexOf(briefVisible.slice(i, i + 8));
        if (j < 0) { i += 1; continue; }
        let length = 8;
        while (i + length < briefVisible.length && j + length < sourceVisible.length && briefVisible[i + length] === sourceVisible[j + length]) length += 1;
        leaks.push({briefVisibleStart: i, briefVisibleEnd: i + length, sourceVisibleStart: j, sourceVisibleEnd: j + length, matchVisibleChars: length, matchSha256: hash(briefVisible.slice(i, i + length))});
        i += length;
    }
    return leaks;
}

let httpRequestsAttempted = 0;

async function run(): Promise<void> {
    await mkdir(temp, {recursive: true});

    const promptFile = await readFile(paths.prompt, "utf8");
    const blocks = [...promptFile.matchAll(/```text\r?\n([\s\S]*?)\r?\n```/gu)].map((match) => match[1] ?? "");
    check(hash(promptFile) === contract.promptFileSha256 && blocks.length === 2, "prompt-invalid");
    const [systemPrompt, userTemplate] = blocks as [string, string];
    check(hash(systemPrompt) === contract.systemSha256 && hash(userTemplate) === contract.userTemplateSha256, "prompt-block-hash-mismatch");

    const referenceBrief = (await readFile(paths.referenceBrief, "utf8")).trim();
    check(hash(referenceBrief) === contract.referenceBriefSha256, "reference-brief-hash-mismatch");
    const userPrompt = userTemplate.replace("{REFERENCE_BRIEF}", referenceBrief);
    check(!/\{[A-Z_]+\}/u.test(userPrompt), "user-prompt-placeholder-unresolved");

    const archive = unzipSync(new Uint8Array(await readFile(paths.epub)));
    const member = archive[contract.member];
    check(member, "source-member-missing");
    const source = sourceText(new TextDecoder().decode(member));
    check(hash(source) === contract.sourceSha256, "source-hash-mismatch");

    const config = JSON.parse(await readFile(paths.config, "utf8")) as {
        models?: {providers?: Array<{id?: string; enabled?: boolean; options?: {apiKey?: unknown; baseURL?: unknown; timeoutMs?: unknown}; models?: Array<{id?: string; enabled?: boolean}>}>};
    };
    const provider = config.models?.providers?.find((item) => item.id === contract.provider);
    check(provider?.enabled && provider.models?.some((item) => item.id === contract.model && item.enabled), "provider-or-model-disabled");
    check(typeof provider.options?.apiKey === "string" && typeof provider.options.baseURL === "string", "provider-config-missing");
    const baseUrl = provider.options.baseURL.replace(/\/+$/u, "");
    check(new URL(baseUrl).hostname === "api.deepseek.com", "provider-host-mismatch");

    if (process.env.NBOOK_PREFLIGHT_ONLY === "1") {
        console.log(JSON.stringify({preflightOnly: true, purpose: contract.purpose, version: contract.version, originalChapterSentToModel: false, httpRequestsAttempted}, null, 2));
        return;
    }

    check(process.env.NBOOK_AUTHORIZED_MODEL_CALL === contract.purpose, "model-call-not-authorized");
    check(!(await Bun.file(paths.brief).exists()) && !(await Bun.file(paths.stats).exists()), "output-already-exists");

    let brief = "";
    let leaks = [] as ReturnType<typeof detectSourceLeaks>;
    let failure: string | null = null;
    let responseInfo: Record<string, unknown> = {};
    try {
        const started = performance.now();
        httpRequestsAttempted = 1;
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {"Content-Type": "application/json", Authorization: `Bearer ${provider.options.apiKey}`},
            body: JSON.stringify({model: contract.model, messages: [{role: "system", content: systemPrompt}, {role: "user", content: userPrompt}], thinking: {type: "disabled"}, stream: false, max_tokens: contract.maxTokens}),
            redirect: "error",
            signal: AbortSignal.timeout(Math.min(typeof provider.options.timeoutMs === "number" ? provider.options.timeoutMs : 360_000, 360_000)),
        });
        const payload = await response.json() as {choices?: Array<{finish_reason?: unknown; message?: {content?: unknown}}>; usage?: {prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown}};
        responseInfo = {
            httpStatus: response.status,
            durationMs: Math.round(performance.now() - started),
            finishReason: payload.choices?.[0]?.finish_reason ?? null,
            observedChoiceCount: payload.choices?.length ?? null,
            usage: {inputTokens: payload.usage?.prompt_tokens ?? null, outputTokens: payload.usage?.completion_tokens ?? null, totalTokens: payload.usage?.total_tokens ?? null},
        };
        check(response.ok, `http-status-${response.status}`);
        check(payload.choices?.length === 1 && typeof payload.choices[0]?.message?.content === "string" && payload.choices[0].message.content.trim(), "response-content-invalid");
        brief = payload.choices[0].message.content.trim();
        await Bun.write(paths.candidate, brief);
        leaks = detectSourceLeaks(brief, source);
        await Bun.write(paths.brief, `${brief}\n`);
    } catch (error) {
        failure = error instanceof Error ? error.message : "unknown-error";
    } finally {
        await rm(paths.candidate, {force: true});
    }

    await Bun.write(paths.stats, `${JSON.stringify({
        schema: "nbook.summary-level-2-brief-only-v7-final-official-call-stats.spike/v1",
        generatedAt: new Date().toISOString(),
        provider: contract.provider,
        model: contract.model,
        baseUrlHost: new URL(baseUrl).hostname,
        source: {ref: contract.member, normalization: "chapter-source-normalization/v1", sha256: contract.sourceSha256},
        prompt: {evidenceRef: "evidences/chapter-001-summary-level-2-brief-only-prompt-v7-repaired-v4.md", fileSha256: contract.promptFileSha256, systemSha256: contract.systemSha256, userTemplateSha256: contract.userTemplateSha256, version: contract.version, maxTokens: contract.maxTokens, thinking: "disabled"},
        modelInput: {kind: "accepted-v4-brief", sha256: contract.referenceBriefSha256, originalChapterSentToModel: false},
        transport: {kind: "single-fetch", redirects: "error", httpRequestsAttempted, applicationRetries: 0, libraryRetries: 0},
        response: {...responseInfo, requiredExactlyOneChoice: true, requiredNonEmptyString: true, responseEnvelopePersisted: false, candidatePersistedInRepository: false},
        privacyDiagnostic: {sourceLeaks: leaks, sourceLeakRejected: false},
        persistence: {briefPersisted: failure === null, temporaryCandidateDeleted: true},
        call: {purpose: contract.purpose, promptVersion: contract.version, status: failure === null ? "accepted" : "failed-after-authorized-request", failureCategory: failure},
        brief: failure === null ? {sha256: hash(brief), visibleChars: visible(brief).length, paragraphCount: brief.split(/(?:\r?\n){2,}/u).filter((part) => part.trim()).length, note: "模型候选；正式 final 另经宿主确定性事实归属与零重合修订"} : null,
    }, null, 2)}\n`);

    console.log(JSON.stringify({status: failure === null ? "accepted" : "failed", purpose: contract.purpose, failureCategory: failure, httpRequestsAttempted, briefPersisted: failure === null}));
    if (failure !== null) process.exitCode = 1;
}

try {
    await run();
} catch (error) {
    console.error(JSON.stringify({status: httpRequestsAttempted === 0 ? "failed-before-request" : "failed-after-authorized-request", failureCategory: error instanceof Error ? error.message : "unknown-error", httpRequestsAttempted}));
    process.exitCode = 1;
} finally {
    await rm(paths.candidate, {force: true});
}
