/** Host adapters consume this entry; file layout and lock mechanics stay inside Storage. */
export {StorageService, StorageHandle} from "nbook/server/storage/storage-service";
export type {
    StorageAccessContext, StorageHandleInput, StorageServiceOptions,
    StorageReadOptions, StorageConditionalInput, StorageSaveInput, StorageRepairInput,
    StorageReclaimInput, StorageSubscribeOptions,
} from "nbook/server/storage/storage-service";
export type {StorageSubscription} from "nbook/server/storage/storage-subscription";
export {ensureStorageIdentityDomain} from "nbook/server/storage/identity-domain";
export {
    StorageAccessContextRegistry,
    STORAGE_ACCESS_CONTEXT_LIMIT,
    STORAGE_ACCESS_CONTEXT_CLIENT_LIMIT,
    STORAGE_ACCESS_CONTEXT_IDLE_MS,
    STORAGE_LOCAL_SESSION_GENERATION,
    deriveStorageClientId,
    deriveStorageSessionGeneration,
    localStorageSubject,
    userStorageSubject,
} from "nbook/server/storage/access-context";
export type {
    StorageAccessContextClaims,
    StorageAccessContextLease,
} from "nbook/server/storage/access-context";
export {userStorageRootFromWorkspaceRoot, projectStorageRootFromProjectRoot} from "nbook/server/storage/storage-address";
