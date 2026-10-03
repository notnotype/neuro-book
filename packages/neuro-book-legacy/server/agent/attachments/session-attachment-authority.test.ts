import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {describe, expect, it} from "vitest";
import {closeAllProjects, resetProjectSessionsForTest} from "nbook/server/runtime/product-project";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {SessionAttachmentAuthority} from "nbook/server/agent/attachments/session-attachment-authority";
import type {JsonlSessionRepository, SessionFileSignature} from "nbook/server/agent/session/session-repo";
import type {SessionEntry, SessionMetadata} from "nbook/server/agent/session/types";
describe("SessionAttachmentAuthority rebuild", () => {
    it("第二次扫描签名仍变化时 fail closed，下一次访问重新构建", async () => {
        const repo = new SignatureRepository([
            signature("precheck", 0),
            signature("a", 1),
            signature("b", 2),
            signature("c", 3),
            signature("d", 4),
        ]);
        const authority = new SessionAttachmentAuthority(repo as unknown as JsonlSessionRepository);

        await expect(authority.list(1, {offset: 0, limit: 40})).rejects.toThrow("持续变化");

        repo.signatures.push(
            signature("stable", 5),
            signature("stable", 5),
            signature("stable", 5),
        );
        await expect(authority.list(1, {offset: 0, limit: 40})).resolves.toEqual({
            items: [],
            total: 0,
            offset: 0,
            limit: 40,
            hasMore: false,
        });
        expect(repo.scanCount).toBe(3);
    });

    it("closed Project允许durable ownership admission校验，但locator仍fail closed", async () => {
        const stableSignatures = Array.from({length: 5}, () => signature("stable", 1));
        const attachmentId = `sha256:${"a".repeat(64)}` as const;
        const metadata: SessionMetadata = {
            schemaVersion: 2,
            sessionId: 1,
            profileKey: "test",
            initial: {},
            currentProjectRoot: "closed-attachment-admission",
            createdAt: 1,
        };
        const entry: SessionEntry = {
            id: "attachment-entry",
            parentId: null,
            timestamp: 1,
            type: "session_attachment",
            origin: "projection",
            attachment: {id: attachmentId, mimeType: "image/png", bytes: 8},
            name: "cover.png",
            source: "upload",
        };
        const repo = new SignatureRepository(stableSignatures, metadata, [entry]);
        const authority = new SessionAttachmentAuthority(repo as unknown as JsonlSessionRepository);
        setWorkspaceRuntimeRootContextForTest({workspaceRoot: testHostPath("session-attachment-authority")});
        try {
            await expect(authority.validateDurableOwnership(1)).resolves.toBeUndefined();
            await expect(authority.resolveDurableOwnership(1, [attachmentId])).resolves.toEqual(new Map([[
                attachmentId,
                {
                    type: "attachment",
                    attachment: {id: attachmentId, mimeType: "image/png", bytes: 8},
                    name: "cover.png",
                },
            ]]));
            await expect(authority.locator(1, "attachment-entry", 0)).rejects.toThrow("Project未打开");
        } finally {
            await closeAllProjects();
            resetProjectSessionsForTest();
            setWorkspaceRuntimeRootContextForTest(null);
        }
    });
});

class SignatureRepository {
    scanCount = 0;

    constructor(
        readonly signatures: SessionFileSignature[],
        readonly metadata: SessionMetadata = {
            schemaVersion: 2,
            sessionId: 1,
            profileKey: "test",
            initial: {},
            createdAt: 1,
        },
        private readonly entries: SessionEntry[] = [],
    ) {}

    async sessionFileSignature(): Promise<SessionFileSignature> {
        const next = this.signatures.shift();
        if (!next) throw new Error("测试签名耗尽");
        return next;
    }

    async scanEntries(_sessionId: number, visitor: (entry: SessionEntry) => void): Promise<SessionMetadata> {
        this.scanCount += 1;
        for (const entry of this.entries) {
            visitor(entry);
        }
        return this.metadata;
    }
}

function signature(identity: string, value: number): SessionFileSignature {
    return {
        identity,
        size: String(value),
        mtimeNs: String(value),
    };
}
