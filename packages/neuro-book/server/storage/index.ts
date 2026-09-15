/** Host adapters consume this entry; file layout and lock mechanics stay inside Storage. */
export {StorageService, StorageHandle} from "nbook/server/storage/storage-service";
export type {
    StorageAccessContext, StorageHandleInput, StorageServiceOptions,
    StorageReadOptions, StorageConditionalInput, StorageSaveInput, StorageRepairInput,
    StorageReclaimInput, StorageSubscribeOptions,
} from "nbook/server/storage/storage-service";
export type {StorageSubscription} from "nbook/server/storage/storage-subscription";
export {ensureStorageIdentityDomain} from "nbook/server/storage/identity-domain";
export {userStorageRootFromWorkspaceRoot, projectStorageRootFromProjectRoot} from "nbook/server/storage/storage-address";
