import {ImageVariantModule} from "nbook/server/media/image-variant";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import path from "node:path";

const runtime = globalThis as typeof globalThis & {
    __nbookImageVariantModule?: ImageVariantModule;
    __nbookImageVariantRoot?: string;
};

/** 返回绑定当前Cache Root的进程级共享Image Variant Module。 */
export function useImageVariantModule(): ImageVariantModule {
    const paths = runtimePathsFromEnv();
    const cacheRoot = paths.imageVariantRoot;
    if (!runtime.__nbookImageVariantModule || runtime.__nbookImageVariantRoot !== cacheRoot) {
        const obsoleteCacheRoot = absoluteFsPath(path.join(paths.stateRoot, "cache", "image-variants"));
        runtime.__nbookImageVariantModule = new ImageVariantModule(cacheRoot, undefined, obsoleteCacheRoot);
        runtime.__nbookImageVariantRoot = cacheRoot;
    }
    return runtime.__nbookImageVariantModule;
}

/** 测试隔离使用：清除进程级实例，不删除任何缓存文件。 */
export function resetImageVariantModuleForTest(): void {
    runtime.__nbookImageVariantModule = undefined;
    runtime.__nbookImageVariantRoot = undefined;
}
