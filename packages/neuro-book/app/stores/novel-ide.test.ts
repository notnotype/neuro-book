import {createPinia, defineStore, setActivePinia} from "pinia";
import {computed, ref, watch} from "vue";
import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {ProjectCatalogRefreshError} from "nbook/app/utils/project-mutation-error";

type FetchMock = ReturnType<typeof vi.fn>;

describe("useNovelIdeStore Project Catalog", () => {
    beforeAll(() => {
        const globals = globalThis as typeof globalThis & Record<string, unknown>;
        globals.defineStore = defineStore;
        globals.ref = ref;
        globals.computed = computed;
        globals.watch = watch;
        globals.piniaPluginPersistedstate = {sessionStorage: () => ({})};
    });

    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it("同 generation 的 Project GET 使用 single-flight", async () => {
        const gate = deferred<ProjectListResponse>();
        const fetch = installFetch(vi.fn(async () => await gate.promise));
        const store = await createStore();

        const first = store.loadProjects();
        const second = store.loadProjects();
        expect(fetch).toHaveBeenCalledTimes(1);

        gate.resolve(projectList(1, "book-a"));
        await expect(Promise.all([first, second])).resolves.toEqual([
            projectList(1, "book-a"),
            projectList(1, "book-a"),
        ]);
        expect(store.novels.map((project) => project.projectRoot)).toEqual(["book-a"]);
        expect(Object.isFrozen(store.novels)).toBe(true);
        expect(Object.isFrozen(store.novels[0])).toBe(true);
        expect(Reflect.set(store.novels[0]!, "title", "mutated")).toBe(false);
        expect(store.novels[0]?.title).toBe("book-a");
    });

    it("mutation 使更早启动的 GET 失效并追读当前 snapshot", async () => {
        const stale = deferred<ProjectListResponse>();
        let getCount = 0;
        installFetch(vi.fn(async (url: string, options?: {method?: string}) => {
            if (url === "/api/projects" && options?.method === "POST") {
                return {revision: 2, project: projectFixture("created")};
            }
            getCount += 1;
            if (getCount === 1) return projectList(1, "existing");
            if (getCount === 2) return await stale.promise;
            return projectList(2, "existing", "created");
        }));
        const store = await createStore();
        await store.loadProjects();

        const staleLoad = store.loadProjects();
        await store.createProject("Created");
        stale.resolve(projectList(1, "existing"));
        await staleLoad;

        expect(store.novels.map((project) => project.projectRoot)).toEqual(["existing", "created"]);
        // mutation 权威刷新已结算后，迟到的旧 GET 会在当前 generation 再读一次。
        expect(getCount).toBe(4);
    });

    it("失效 GET 即使失败也追读当前 generation 的 single-flight", async () => {
        const stale = deferred<ProjectListResponse>();
        const current = deferred<ProjectListResponse>();
        let getCount = 0;
        installFetch(vi.fn(async (url: string, options?: {method?: string}) => {
            if (url === "/api/projects" && options?.method === "POST") {
                return {revision: 2, project: projectFixture("created")};
            }
            getCount += 1;
            if (getCount === 1) return projectList(1, "existing");
            if (getCount === 2) return await stale.promise;
            return await current.promise;
        }));
        const store = await createStore();
        await store.loadProjects();

        const staleLoad = store.loadProjects();
        const mutation = store.createProject("Created");
        await vi.waitFor(() => expect(getCount).toBe(3));
        stale.reject(new Error("stale catalog failed"));
        current.resolve(projectList(2, "created", "existing"));

        await expect(Promise.all([staleLoad, mutation])).resolves.toEqual([
            projectList(2, "created", "existing"),
            "created",
        ]);
        expect(getCount).toBe(3);
        expect(store.novels.map((project) => project.projectRoot)).toEqual(["created", "existing"]);
    });

    it("create、cover 与 delete 每次成功后都按完整 snapshot 的顺序发布", async () => {
        let getCount = 0;
        installFetch(vi.fn(async (url: string, options?: {method?: string}) => {
            if (url === "/api/projects" && options?.method === "POST") {
                return {revision: 2, project: projectFixture("created", "2026-01-04T00:00:00.000Z")};
            }
            if (url.startsWith("/api/projects/cover?") && options?.method === "DELETE") {
                return {revision: 3, project: projectFixture("cover", "2026-01-05T00:00:00.000Z")};
            }
            if (url === "/api/projects/item" && options?.method === "DELETE") {
                return {revision: 4, projectRoot: "deleted"};
            }
            getCount += 1;
            if (getCount === 1) {
                return {
                    revision: 1,
                    projects: [
                        projectFixture("older", "2026-01-03T00:00:00.000Z"),
                        {...projectFixture("cover", "2026-01-02T00:00:00.000Z"), cover: "assets/project-covers/old.png"},
                        projectFixture("deleted", "2026-01-01T00:00:00.000Z"),
                    ],
                };
            }
            if (getCount === 2) {
                return {
                    revision: 2,
                    projects: [
                        projectFixture("created", "2026-01-04T00:00:00.000Z"),
                        projectFixture("older", "2026-01-03T00:00:00.000Z"),
                        {...projectFixture("cover", "2026-01-02T00:00:00.000Z"), cover: "assets/project-covers/old.png"},
                        projectFixture("deleted", "2026-01-01T00:00:00.000Z"),
                    ],
                };
            }
            if (getCount === 3) {
                return {
                    revision: 3,
                    projects: [
                        projectFixture("cover", "2026-01-05T00:00:00.000Z"),
                        projectFixture("created", "2026-01-04T00:00:00.000Z"),
                        projectFixture("older", "2026-01-03T00:00:00.000Z"),
                        projectFixture("deleted", "2026-01-01T00:00:00.000Z"),
                    ],
                };
            }
            return {
                revision: 4,
                projects: [
                    projectFixture("cover", "2026-01-05T00:00:00.000Z"),
                    projectFixture("created", "2026-01-04T00:00:00.000Z"),
                    projectFixture("older", "2026-01-03T00:00:00.000Z"),
                ],
            };
        }));
        const store = await createStore();
        await store.loadProjects();

        await store.createProject("Created");
        expect(store.novels.map((project) => project.projectRoot)).toEqual(["created", "older", "cover", "deleted"]);

        await store.updateProjectCover("cover", null);
        expect(store.novels.map((project) => project.projectRoot)).toEqual(["cover", "created", "older", "deleted"]);
        expect(store.novels.find((project) => project.projectRoot === "cover")?.cover).toBeUndefined();

        await store.deleteProject("deleted");
        expect(getCount).toBe(4);
        expect(store.novels.map((project) => project.projectRoot)).toEqual(["cover", "created", "older"]);
    });

    it("并发 mutation 响应乱序时以完整 snapshot 收口", async () => {
        const firstCreate = deferred<{revision: number; project: ReturnType<typeof projectFixture>}>();
        const secondCreate = deferred<{revision: number; project: ReturnType<typeof projectFixture>}>();
        let createCount = 0;
        let getCount = 0;
        installFetch(vi.fn(async (url: string, options?: {method?: string}) => {
            if (url === "/api/projects" && options?.method === "POST") {
                createCount += 1;
                return await (createCount === 1 ? firstCreate.promise : secondCreate.promise);
            }
            getCount += 1;
            return getCount === 1
                ? projectList(1, "existing")
                : projectList(3, "existing", "first", "second");
        }));
        const store = await createStore();
        await store.loadProjects();

        const first = store.createProject("First");
        const second = store.createProject("Second");
        secondCreate.resolve({revision: 3, project: projectFixture("second")});
        await expect(second).resolves.toBe("second");
        firstCreate.resolve({revision: 2, project: projectFixture("first")});
        await expect(first).resolves.toBe("first");

        expect(getCount).toBe(3);
        expect(store.novels.map((project) => project.projectRoot)).toEqual(["existing", "first", "second"]);
    });

    it("完整 GET 可以在服务重启后发布较小 revision", async () => {
        const fetch = installFetch(vi.fn()
            .mockResolvedValueOnce(projectList(9, "before-restart"))
            .mockResolvedValueOnce(projectList(1, "after-restart")));
        const store = await createStore();

        await store.loadProjects();
        await store.loadProjects();

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(store.novels.map((project) => project.projectRoot)).toEqual(["after-restart"]);
    });

    it("mutation 已成功但完整刷新失败时保留 committed true", async () => {
        installFetch(vi.fn()
            .mockResolvedValueOnce(projectList(1, "existing"))
            .mockResolvedValueOnce({revision: 3, project: projectFixture("created")})
            .mockRejectedValueOnce(new Error("catalog offline")));
        const store = await createStore();
        await store.loadProjects();

        await expect(store.createProject("Created")).rejects.toBeInstanceOf(ProjectCatalogRefreshError);
    });

    it("delete 与 cover 已成功但完整刷新失败时同样保留 committed true", async () => {
        installFetch(vi.fn()
            .mockResolvedValueOnce(projectList(1, "deleted"))
            .mockResolvedValueOnce({revision: 2, projectRoot: "deleted"})
            .mockRejectedValueOnce(new Error("delete catalog offline")));
        const deleteStore = await createStore();
        await deleteStore.loadProjects();

        await expect(deleteStore.deleteProject("deleted")).rejects.toMatchObject({
            name: "ProjectCatalogRefreshError",
            operation: "delete",
            committed: true,
        });

        setActivePinia(createPinia());
        installFetch(vi.fn()
            .mockResolvedValueOnce(projectList(1, "cover"))
            .mockResolvedValueOnce({revision: 2, project: projectFixture("cover")})
            .mockRejectedValueOnce(new Error("cover catalog offline")));
        const coverStore = await createStore();
        await coverStore.loadProjects();

        await expect(coverStore.updateProjectCover("cover", null)).rejects.toMatchObject({
            name: "ProjectCatalogRefreshError",
            operation: "cover-update",
            committed: true,
        });
    });

    it("删除成功后清理对应 workspace session，不自动激活其它 Project", async () => {
        let getCount = 0;
        installFetch(vi.fn(async (url: string, options?: {method?: string}) => {
            if (url === "/api/projects/item" && options?.method === "DELETE") {
                return {revision: 2, projectRoot: "deleted"};
            }
            getCount += 1;
            return getCount === 1 ? projectList(1, "deleted", "next") : projectList(2, "next");
        }));
        const store = await createStore();
        await store.loadProjects();
        store.currentProjectRoot = "deleted";
        store.workspaceSessions = {
            "novel:deleted": createWorkspaceSession("manuscript/deleted.md"),
            "novel:next": createWorkspaceSession("manuscript/next.md"),
        };

        await store.deleteProject("deleted");

        expect(store.currentProjectRoot).toBe("");
        expect(store.workspaceSessions["novel:deleted"]).toBeUndefined();
        expect(store.workspaceSessions["novel:next"]).toBeDefined();
        expect(store.novels.map((project) => project.projectRoot)).toEqual(["next"]);
    });

    it("初始化已由 ProjectSession 激活的 workspace 不再查询 Catalog", async () => {
        const fetch = installFetch(vi.fn(async (url: string) => {
            if (url === "/api/workspace-files/tree") {
                return {nodes: [], issues: [], revision: 1, validatedAt: new Date().toISOString()};
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }));
        const store = await createStore();
        store.currentProjectRoot = "direct-open";
        expect(store.currentNovel).toBeNull();
        expect(store.currentWorkspaceRoot).toBe("workspace/direct-open");

        await store.initializeWorkspace();

        expect(fetch).not.toHaveBeenCalledWith("/api/projects");
        expect(store.currentProjectRoot).toBe("direct-open");
        expect(store.currentWorkspaceRoot).toBe("workspace/direct-open");
    });
});

type ProjectListResponse = {
    revision: number;
    projects: ReturnType<typeof projectFixture>[];
};

/** 安装当前用例独占的 $fetch mock。 */
function installFetch(fetch: FetchMock): FetchMock {
    (globalThis as typeof globalThis & {$fetch: typeof globalThis.$fetch}).$fetch = fetch as unknown as typeof globalThis.$fetch;
    return fetch;
}

/** 每个用例在独立 Pinia 中创建 Store。 */
async function createStore() {
    const {useNovelIdeStore} = await import("nbook/app/stores/novel-ide");
    return useNovelIdeStore();
}

/** 构造完整 Catalog snapshot。 */
function projectList(revision: number, ...projectRoots: string[]): ProjectListResponse {
    return {revision, projects: projectRoots.map((projectRoot) => projectFixture(projectRoot))};
}

/** 构造轻量 Project metadata。 */
function projectFixture(projectRoot: string, manifestUpdatedAt = "2026-01-01T00:00:00.000Z") {
    return {
        projectRoot,
        kind: "novel" as const,
        title: projectRoot,
        summary: "",
        manifestUpdatedAt,
    };
}

/** 创建可控 Promise，稳定排列 GET 与 mutation。 */
function deferred<T>() {
    let resolve = (_value: T): void => undefined;
    let reject = (_error: unknown): void => undefined;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

/** 构造本地 workspace 标签记忆。 */
function createWorkspaceSession(path: string) {
    return {
        activeWorkspaceTabPath: path,
        workspaceTabs: [{
            path,
            title: path,
            editorGroupId: "main" as const,
            editorId: "markdown",
            pinned: false,
            preview: false,
            dirty: false,
        }],
        workspaceBuffers: {},
        monacoFontSizeOverridesByPath: {},
    };
}
