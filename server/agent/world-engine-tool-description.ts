import {profileText} from "nbook/server/agent/profiles/profile-text";
import type {ExecuteWorldMode} from "nbook/server/world-engine/world-engine.facade";

/** 构造 execute_world 在不同 profile 权限下暴露给模型的工具说明。 */
export function buildExecuteWorldDescription(mode: ExecuteWorldMode): string {
    const writeApi = mode === "readwrite"
        ? profileText`
            Write API is also available:

            \`\`\`typescript
            world.slice.write({
                time: bigint,
                title?: string,
                summary?: string,
                kind?: string,
                patches: Array<{
                    subjectId: string,
                    path: string,
                    op: "replace" | "increment" | "remove" | "append",
                    value?: unknown,
                    summary?: string,
                    type?: string,
                    name?: string,
                }>,
            }): Promise<{sliceId: string; issues: WorldIssue[]}>;

            world.slice.editPatches(
                sliceId: string,
                edits: Array<
                    | {patchId: string, set: {path?: string, op?: string, value?: unknown, summary?: string}}
                    | {patchId: string, remove: true}
                    | {add: {subjectId: string, path: string, op: string, value?: unknown, summary?: string}}
                >,
                meta?: {time?: bigint, title?: string, summary?: string, kind?: string},
            ): Promise<{sliceId: string; issues: WorldIssue[]}>;

            world.slice.delete(sliceId: string): Promise<{issues: WorldIssue[]}>;
            \`\`\`

            Writing rules:
            - Write time is an instant bigint. Use world.time.parse("项目日历字符串") before writing and world.time.format(instant) when returning human-readable summaries.
            - One instant can have only one slice. If several location, character, or event changes happen at the same instant, put all of them into one world.slice.write({patches:[...]}) call.
            - Before writing to a target time, check for an existing slice with world.slice.list({from: time, to: time, withPatches: true}).
            - If a slice already exists and every added subject is already registered, merge extra changes with world.slice.editPatches(existingSliceId, [{add:{...}}]).
            - If a same-instant change introduces a new subject, include that subject's first-write type/name patches in the original world.slice.write call. world.slice.editPatches({add}) does not register new subjects.
            - Use JSON Pointer paths everywhere, such as /hp or /memory/师门.
            - Do not catch and swallow write errors. If returned issues include severity: "error", throw to roll back the whole script.
            - If returned issues include severity: "advisory", do not roll back automatically; include a concise user-facing confirmation or follow-up using title/message/explanation.
            - Do not return issues yourself; the tool result always includes collector issues as {data, issues}.
            - To fix a wrong patch in an existing slice, read patchId via world.slice.get(sliceId) or world.slice.list({withPatches:true}), then use world.slice.editPatches. Do not delete and rewrite a whole slice just to fix one patch.
            - For EmbeddingText fields, write only {text:"..."}. vector/model are maintained by the system.
        `
        : profileText`
            This profile has readonly World Engine access. world.slice.write, world.slice.editPatches, and world.slice.delete are not available.
        `;

    return profileText`
        Execute JavaScript code against the specified Project Workspace World Engine.

        The tool always returns:

        \`\`\`typescript
        { data: unknown, issues: WorldIssue[] }
        \`\`\`

        WorldIssue includes code, label, severity, title, message, and explanation. Use title/message/explanation when explaining issues to the user; code is for filtering and debugging.

        Return rules:
        - When you query subject state for yourself or the user and the subject schema shape is clear, convert JSON attrs into a human-readable string summary inside the script, then return that string.
        - Return objects or arrays only when the next step truly needs structured data. Do not return raw subject state JSON just because it is easy.
        - A returned string is shown to you as the primary tool text; issues are still collected separately in tool details.

        Read API:

        \`\`\`typescript
        world.time.parse(calendarText: string): bigint;
        world.time.format(instant: bigint): string;
        world.time.now(): bigint;

        world.subject.get(id: string, options?: {deref?: boolean, derefDepth?: number}): Promise<any | null>; // returns attrs directly, e.g. hero.hp, not hero.attrs.hp
        world.subject.gets(ids: string[]): Promise<Array<any | null>>; // each item is attrs directly or null
        world.subject.list(type?: string): Promise<Array<{id: string, type: string, name: string}>>;
        world.subject.findRefs(targetId: string, sourceType?: string): Promise<Array<{subjectId: string, attr: string}>>;

        world.search.text(query: string, options?: {k?: number, threshold?: number, types?: string[], attrs?: string[], at?: bigint}): Promise<Array<{subjectId: string, attr: string, text: string, score: number}>>;

        world.slice.list(options?: {from?: bigint, to?: bigint, limit?: number, withPatches?: boolean, subjectIds?: string[], subjectMode?: "any" | "all"}): Promise<any[]>;
        world.slice.get(sliceId: string): Promise<{id: string, instant: bigint, title: string, summary: string, kind: string, patches: Array<{patchId: string, subjectId: string, path: string, op: string, value?: unknown, summary?: string}>}>;
        \`\`\`

        Search rules:
        - world.search.text options.types filters subject types such as character or location; it does not mean event text or slice kind.
        - To search event text, use attrs: ["events"].
        - world.slice.get only accepts sliceId. To find slices touching a subject, use world.slice.list({subjectIds:["subject-id"], withPatches:true}).
        - world.subject.get returns the subject's attrs object directly: const hero = await world.subject.get("hero"); return hero.hp.

        ${writeApi}

        Constraints:
        - Code must be inline in the code argument.
        - The sandbox is a plain async script body: import / require / export are NOT available and will throw. Use only the injected \`world\` API plus standard JS builtins (JSON, Math, Array...). No filesystem, network, or Node API access — never try to load schema/calendar files from inside the sandbox; they are loaded for you.
        - Use await for async world.subject.* / world.search.* / world.slice.* methods.
        - Result data is limited to 10KB; return a human-readable string summary or selected fields, not full world dumps. When listing many subjects/slices, map each to a short line (id / title / time) inside the script instead of returning raw objects.
        - If the world config is missing (schema/calendar not initialized), report the error to your caller as-is — do NOT try to create config files yourself or fall back to another worldKey.
        - BigInt values are serialized as strings in the final tool details.
    `;
}
