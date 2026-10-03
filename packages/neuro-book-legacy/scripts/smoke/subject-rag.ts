import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {resolveAgentTempRoot} from "@notnotype/neuro-book-test-support/paths";
import {
    markSubjectRagDirty,
    searchSubjectRag,
    type SubjectPaths,
} from "nbook/server/agent/tools/subject-rag-index";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {closeAllProjects, openProject} from "nbook/server/runtime/product-project";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

/**
 * Bun runtime 下验证 subject RAG 能加载 sqlite-vec、调用 embedding、建索引并检索。
 */
async function main(): Promise<void> {
    const agentTempRoot = resolveAgentTempRoot();
    await mkdir(agentTempRoot, {recursive: true});
    const root = await mkdtemp(join(agentTempRoot, "subject-rag-smoke-"));
    const workspaceRoot = absoluteFsPath(join(root, "workspace"));
    setWorkspaceRuntimeRootContextForTest({workspaceRoot});
    const projectRef = projectWorkspaceRef("demo");
    const projectDirectory = join(workspaceRoot, projectRef.projectRoot);
    const subjectRoot = join(projectDirectory, "simulation", "subjects", "heroine");
    const otherSubjectRoot = join(projectDirectory, "simulation", "subjects", "other");
    const originalFetch = globalThis.fetch;
    try {
        await mkdir(subjectRoot, {recursive: true});
        await mkdir(otherSubjectRoot, {recursive: true});
        await mkdir(join(workspaceRoot, ".nbook"), {recursive: true});
        await mkdir(join(projectDirectory, ".nbook"), {recursive: true});
        await writeFile(join(projectDirectory, "project.yaml"), "kind: novel\ntitle: Subject RAG Smoke\nsummary: ''\n", "utf-8");
        await writeFile(join(subjectRoot, "events.jsonl"), [
            "{\"text\":\"艾琳娜在入学当天早晨帮我避免迟到。\"}",
            "{\"text\":\"我在傍晚又走错了王都学院附近的路。\"}",
            "",
        ].join("\n"), "utf-8");
        await writeFile(join(subjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"艾琳娜是帮过我的粉色头发同学，我对她有感激和信任。\"}\n", "utf-8");
        await writeFile(join(otherSubjectRoot, "events.jsonl"), [
            "{\"text\":\"别的 subject 和艾琳娜刚刚完成了最相近的互动，但不应被当前 subject 召回。\"}",
            "{\"text\":\"别的 subject 又一次和艾琳娜谈起早晨的事，但不应被当前 subject 召回。\"}",
            "",
        ].join("\n"), "utf-8");
        await writeFile(join(otherSubjectRoot, "memory.jsonl"), "{\"topic\":\"艾琳娜\",\"view\":\"这条属于 other。\"}\n", "utf-8");
        await writeFile(join(workspaceRoot, ".nbook", "config.json"), JSON.stringify({
            models: {
                default: "local/chat",
                providers: [{
                    id: "local",
                    name: "Local",
                    api: "openai-completions",
                    options: {
                        apiKey: "sk-local",
                        baseURL: "https://embedding.test/v1",
                        proxy: "",
                        timeoutMs: null,
                        requestOptions: {},
                    },
                    models: [
                        {id: "chat", name: "Chat", enabled: true, input: ["text"], contextWindowTokens: 128000},
                    ],
                }],
            },
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "global-embed",
                dimensions: 2,
                apiKey: "sk-local",
                baseURL: "https://embedding.test/v1",
                timeoutMs: null,
                requestOptions: {},
            },
        }), "utf-8");
        await writeFile(join(projectDirectory, ".nbook", "config.json"), JSON.stringify({
            embedding: {
                model: "project-embed",
                dimensions: 3,
            },
        }), "utf-8");

        globalThis.fetch = createEmbeddingFetchMock({
            "艾琳娜": [1, 0, 0],
            "王都": [0, 1, 0],
        });
        const currentProject = await openProject(
            projectRef,
            {kind: "job", source: "subject-rag-smoke"},
            workspaceRoot,
        );
        const configTarget = {scope: "project" as const, workspaceRoot, project: currentProject};

        const subject: SubjectPaths = {
            absolutePath: subjectRoot,
            eventsPath: join(subjectRoot, "events.jsonl"),
            memoryPath: join(subjectRoot, "memory.jsonl"),
            ragStatePath: join(projectDirectory, ".nbook", "subject-rag-dirty.json"),
        };
        const eventCandidates = await searchSubjectRag({
            configTarget,
            subject,
            query: "艾琳娜",
            sources: ["events"],
            limit: 3,
        });
        const memoryCandidates = await searchSubjectRag({
            configTarget,
            subject,
            query: "艾琳娜",
            sources: ["memory"],
            limit: 3,
        });
        const eventText = JSON.stringify(eventCandidates);
        const memoryText = JSON.stringify(memoryCandidates);
        if (!eventText.includes("避免迟到")) {
            throw new Error(`subject RAG smoke events 召回内容异常：${eventText}`);
        }
        if (!memoryText.includes("粉色头发同学")) {
            throw new Error(`subject RAG smoke memory 召回内容异常：${memoryText}`);
        }
        if (eventText.includes("这条属于 other") || memoryText.includes("这条属于 other")) {
            throw new Error("subject RAG smoke 跨 subject 泄露了 other 记忆。");
        }
        const memoryOnlyCandidates = await searchSubjectRag({
            configTarget,
            subject,
            query: "艾琳娜",
            sources: ["memory"],
            limit: 1,
        });
        if (!JSON.stringify(memoryOnlyCandidates).includes("粉色头发同学")) {
            throw new Error(`subject RAG smoke memory-only 召回被其他 source 挤掉：${JSON.stringify(memoryOnlyCandidates)}`);
        }
        await markSubjectRagDirty(subject, "memory", await readFile(join(subjectRoot, "memory.jsonl"), "utf-8"));
        const dirtyBeforeSearch = await readFile(join(projectDirectory, ".nbook", "subject-rag-dirty.json"), "utf-8");
        if (!dirtyBeforeSearch.includes("\"memory\"")) {
            throw new Error(`subject RAG smoke 未写入 memory dirty 状态：${dirtyBeforeSearch}`);
        }
        await searchSubjectRag({
            configTarget,
            subject,
            query: "艾琳娜",
            sources: ["memory"],
            limit: 1,
        });
        const dirtyAfterSearch = await readFile(join(projectDirectory, ".nbook", "subject-rag-dirty.json"), "utf-8");
        if (dirtyAfterSearch.includes("\"memory\"")) {
            throw new Error(`subject RAG smoke 搜索后未消费 memory dirty 状态：${dirtyAfterSearch}`);
        }
        await readFile(join(projectDirectory, ".nbook", "subject-rag.sqlite"));
        console.log("subject-rag smoke ok");
    } finally {
        globalThis.fetch = originalFetch;
        try {
            await closeAllProjects();
            await rm(root, {recursive: true, force: true});
        } finally {
            setWorkspaceRuntimeRootContextForTest(null);
        }
    }
}

function createEmbeddingFetchMock(vectors: Record<string, number[]>): typeof fetch {
    return (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {input?: string[]; model?: string; dimensions?: number};
        if (body.model !== "project-embed" || body.dimensions !== 3) {
            throw new Error(`subject RAG smoke 未使用 Project embedding 覆盖：${JSON.stringify({model: body.model, dimensions: body.dimensions})}`);
        }
        const input = Array.isArray(body.input) ? body.input : [];
        return new Response(JSON.stringify({
            data: input.map((text) => ({
                embedding: resolveEmbeddingVector(text, vectors),
            })),
        }), {
            status: 200,
            headers: {"Content-Type": "application/json"},
        });
    }) as typeof fetch;
}

function resolveEmbeddingVector(text: string, vectors: Record<string, number[]>): number[] {
    if (text.includes("最相近的互动") || text.includes("又一次和艾琳娜")) {
        return [1, 0, 0];
    }
    const matched = Object.entries(vectors).find(([keyword]) => text.includes(keyword));
    return matched?.[1] ?? [0.1, 0.1, 0.1];
}

await main();
