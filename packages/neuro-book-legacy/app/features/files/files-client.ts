import {readSseStream} from "nbook/app/utils/http/read-sse";
import {WorkspaceFileBindingDtoSchema, type WorkspaceFileBindingDto} from "nbook/shared/dto/workspace-file-binding.dto";
import type {WorkspaceFileStreamEventDto} from "nbook/shared/dto/workspace-file-events.dto";

/** Project binding is issued by a completed Project Session; a path alone is never a binding. */
export type FilesBinding = WorkspaceFileBindingDto;

export type FilesRead = Readonly<{
    path: string;
    absolutePath: string;
    entryType: string | null;
    editable: boolean;
    mtimeMs: number;
    content: string;
}>;

export type FilesWrite = Readonly<{
    path: string;
    content: string;
    baseContent: string;
    expectedMtimeMs: number | null;
    force: boolean;
}>;

/** Transport owns only HTTP/SSE; it has no document buffers, retries or Project lookup. */
export interface FilesTransport {
    tree<T>(binding: FilesBinding, signal?: AbortSignal): Promise<T>;
    stat<T>(binding: FilesBinding, path: string, signal?: AbortSignal): Promise<T>;
    read(binding: FilesBinding, path: string, signal?: AbortSignal): Promise<FilesRead>;
    write<T>(binding: FilesBinding, input: FilesWrite, signal?: AbortSignal): Promise<T>;
    events(binding: FilesBinding, onEvent: (event: WorkspaceFileStreamEventDto) => void, signal?: AbortSignal): Promise<void>;
}

export function createHttpFilesTransport(): FilesTransport {
    return {
        tree: <T>(binding: FilesBinding, signal?: AbortSignal) => globalThis.$fetch<T>("/api/workspace-files/tree", {query: binding, signal}),
        stat: <T>(binding: FilesBinding, path: string, signal?: AbortSignal) => globalThis.$fetch<T>("/api/workspace-files/stat", {query: {...binding, path}, signal}),
        read: (binding: FilesBinding, path: string, signal?: AbortSignal) => globalThis.$fetch<FilesRead>("/api/workspace-files/read", {query: {...binding, path}, signal}),
        write: <T>(binding: FilesBinding, input: FilesWrite, signal?: AbortSignal) => globalThis.$fetch<T>("/api/workspace-files/write", {
            method: "PUT", body: {...binding, ...input}, signal,
        }),
        async events(binding, onEvent, signal) {
            const response = await fetch(`/api/workspace-files/events?${new URLSearchParams(binding).toString()}`, {method: "GET", signal});
            await readSseStream<WorkspaceFileStreamEventDto>(response, onEvent);
            if (!signal?.aborted) throw new Error("文件事件流已结束，同步已中断");
        },
    };
}

/** One client per exact ready generation; caller owns its lifetime and discards late responses. */
export class FilesClient {
    readonly binding: FilesBinding;

    constructor(binding: FilesBinding, private readonly transport: FilesTransport) {
        this.binding = Object.freeze(WorkspaceFileBindingDtoSchema.parse(binding));
    }

    tree<T>(signal?: AbortSignal): Promise<T> { return this.transport.tree<T>(this.binding, signal); }
    stat<T>(path: string, signal?: AbortSignal): Promise<T> { return this.transport.stat<T>(this.binding, path, signal); }
    read(path: string, signal?: AbortSignal): Promise<FilesRead> { return this.transport.read(this.binding, path, signal); }
    write<T>(input: FilesWrite, signal?: AbortSignal): Promise<T> { return this.transport.write<T>(this.binding, input, signal); }
    events(onEvent: (event: WorkspaceFileStreamEventDto) => void, signal?: AbortSignal): Promise<void> {
        return this.transport.events(this.binding, onEvent, signal);
    }
}
