export const meta = {
    name: 'implement-world-engine-zod-refactor',
    description: 'Implement World Engine schema refactor: Zod + CodeAct + JSON Patch',
    phases: [
        { title: 'Plan', detail: 'Read task and existing code to understand implementation scope' },
        { title: 'Phase 1', detail: 'Schema layer: zod + ref + EmbeddingText', model: 'opus' },
        { title: 'Phase 2', detail: 'Patch operations: 4 ops + summary + JSON Pointer', model: 'opus' },
        { title: 'Phase 3', detail: 'CodeAct: sandbox + execute_world_query + vector search', model: 'opus' },
        { title: 'Verify', detail: 'Review prompts and run tests' }
    ]
};

// Phase 0: Plan - 理解任务范围
phase('Plan');

const taskDoc = await agent(
    'Read docs/tasks/67-world-engine-zod-schema-codeact/README.md and summarize: 1) Three phases and their deliverables 2) Key decisions (15 items) 3) Files to modify 4) Breaking changes',
    { phase: 'Plan', label: 'read-task' }
);

const existingCode = await agent(
    'Read server/world-engine/ directory structure and key files: types.ts, schema-loader.ts, world-engine.service.ts. Summarize current architecture and identify what needs to be replaced vs modified.',
    { phase: 'Plan', label: 'survey-code' }
);

log(`Task scope understood. Starting 3-phase implementation.`);

// Phase 1: Schema layer
phase('Phase 1');

const schemaImpl = await agent(
    `Implement Phase 1: Zod Schema Layer

Task file: docs/tasks/67-world-engine-zod-schema-codeact/README.md

Deliverables:
1. Create world-engine/schema/index.ts with:
   - Ref(targetType) helper using .describe("ref:xxx")
   - EmbeddingText type (text + optional vector/model)
   - .unique() extension for ZodArray
   - Character / Location / Item schemas with full type inference

2. Update server/world-engine/types.ts:
   - Keep old types for Phase 2 compatibility
   - Add new Zod-based types
   - Export extractRefs() function for metadata extraction

3. Update schema-loader.ts to support .ts schemas:
   - Check for schema/index.ts before schema.yaml
   - Load and validate zod schemas
   - Extract refs/unique metadata

Key decisions:
- Ref uses describe("ref:location") - supports circular refs
- All properties write to init slice (including undefined)
- Subject.name is table metadata, not in schema

Verification (8 items in task):
- Schema in schema/index.ts
- .unique() works
- Ref extraction correct
- Nested objects supported
- Circular refs work
- All properties in init slice

Write clean, documented code. Return file paths modified.`,
    { 
        phase: 'Phase 1', 
        label: 'schema-impl',
        effort: 'medium'
    }
);

// Phase 2: Patch operations
phase('Phase 2');

const patchImpl = await agent(
    `Implement Phase 2: Patch Operations

Task file: docs/tasks/67-world-engine-zod-schema-codeact/README.md

Deliverables:
1. Update types.ts:
   - WorldPatchOp = "replace" | "increment" | "remove" | "append"
   - WorldPatch type with op/path/value/summary
   - Remove old WorldMutationOp (6 ops)

2. Rewrite world-engine.service.ts reduce logic:
   - JSON Pointer path parsing (/equipment/head)
   - 4 op implementations
   - unique array deduplication
   - Reject cross-ref operations (error if path goes past subject://id)

3. Update WorldMutation table schema:
   - Add summary TEXT column
   - Migrate attr to path (add / prefix)

4. Update schema-loader.ts:
   - findAttrSchema to accept / paths
   - Path traversal for nested objects

Key decisions:
- Path format: JSON Pointer (/) not dot notation
- Subject.name is table-level, not schema
- No move op - use two patches
- summary is optional but recommended

Verification (9 items in task):
- 4 ops work correctly
- JSON Pointer parsing
- unique dedup
- summary storage
- Cross-ref rejected

Write clean, documented code. Return file paths modified.`,
    { 
        phase: 'Phase 2', 
        label: 'patch-impl',
        effort: 'high'
    }
);

// Phase 3: CodeAct sandbox + Agent tool
phase('Phase 3');

const codeactImpl = await agent(
    `Implement Phase 3: CodeAct Query System

Task file: docs/tasks/67-world-engine-zod-schema-codeact/README.md

Deliverables:
1. Create server/world-engine/codeact-sandbox.ts:
   - executeCodeAct(code, worldApi, timeout, maxResultSize)
   - Sandbox with Function() + Proxy
   - Block fetch/fs/process/require/eval
   - 5s timeout, 10KB result limit

2. Create server/world-engine/codeact-api.ts:
   - WorldApi interface
   - get/getMany/list/findRefs/searchText/vectorize/slices/now
   - deref with visited Set and depth limit (max 5)

3. Update server/agent/tools/world-engine-tools.ts:
   - Delete all old tools (get_world_state, write_world_slice, etc)
   - Add execute_world_query(projectPath, code?, codePath?)
   - Full API docs in description with examples
   - Save failed code to .temp/ and return path

4. Implement world.vectorize() and world.searchText():
   - Reuse server/agent/tools/subject-rag-index.ts
   - WorldVectorChunk table
   - vec0 virtual table for search

Key decisions:
- Tool name: execute_world_query
- Failed code auto-saves to temp
- Vectorize on explicit call only
- Max deref depth: 5

Verification (13 items in task):
- Sandbox blocks dangerous APIs
- execute_world_query tool works
- code/codePath support
- Temp file on error
- All world.* APIs work
- Vector search
- 10KB limit enforced
- Old tools deleted

Write clean, documented code. Return file paths modified.`,
    { 
        phase: 'Phase 3', 
        label: 'codeact-impl',
        effort: 'high'
    }
);

// Phase 4: Verify - 提示词审查
phase('Verify');

const promptReview = await agent(
    `Review Agent prompt engineering for World Engine

Context: We just refactored World Engine to use:
1. Zod schemas (type-safe, in TypeScript)
2. CodeAct queries (Agent writes JS code)
3. 4 JSON Patch ops (replace/increment/remove/append)

Task:
1. Find all Agent profile files that reference World Engine:
   - assets/workspace/.nbook/agent/profiles/builtin/*.profile.tsx
   - Grep for "world" or "subject" or "timeline"

2. For each profile, check if prompts need updates:
   - Remove references to old tools (get_world_state, write_world_slice)
   - Add execute_world_query guidance if relevant
   - Update schema examples (YAML → TypeScript)
   - Update op names (set/add/listAppend → replace/increment/append)

3. Check example queries and ensure they use new API:
   - world.get() instead of get_world_state()
   - JSON Pointer paths (/equipment/head)
   - New op names

Return list of files that need prompt updates with specific changes needed.`,
    { 
        phase: 'Verify', 
        label: 'prompt-review',
        effort: 'low'
    }
);

const testRun = await agent(
    `Run core World Engine tests

1. Run existing tests:
   bun test server/world-engine/*.test.ts

2. Expected: Many will fail due to API changes
   - Document which tests fail and why
   - Identify tests that need rewriting vs deletion

3. Write 3 new integration tests in server/world-engine/codeact.test.ts:
   - Test 1: Execute simple query with world.get()
   - Test 2: Execute query with deref
   - Test 3: Failed code saves to temp file

Return test results and new test file path.`,
    { 
        phase: 'Verify', 
        label: 'test-run',
        effort: 'medium'
    }
);

// Return summary
return {
    phases: {
        phase1: schemaImpl,
        phase2: patchImpl,
        phase3: codeactImpl
    },
    verification: {
        promptReview,
        testRun
    },
    summary: {
        message: 'World Engine Zod refactor complete. Review prompt updates and test results before merging.',
        nextSteps: [
            '1. Review and apply prompt engineering changes',
            '2. Fix failing tests or rewrite for new API',
            '3. Update reference/world-engine/schema-system.md',
            '4. Test with real project data',
            '5. Commit and notify users of breaking changes'
        ]
    }
};
