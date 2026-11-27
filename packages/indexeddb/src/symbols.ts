/**
 * Internal symbols for cross-class communication within @b9g/indexeddb.
 *
 * These replace _-prefixed properties to hide internals from users
 * who inspect IDB objects.
 */

// IDBRequest
export const kSetSource = Symbol("setSource");
export const kSetTransaction = Symbol("setTransaction");
export const kResolveWithoutEvent = Symbol("resolveWithoutEvent");
export const kResolveRaw = Symbol("resolveRaw");
export const kResolve = Symbol("resolve");
export const kReject = Symbol("reject");
export const kLastDispatchHadError = Symbol("lastDispatchHadError");

// IDBOpenDBRequest
export const kResolveWithVersionChange = Symbol("resolveWithVersionChange");
export const kFireUpgradeNeeded = Symbol("fireUpgradeNeeded");
export const kFireBlocked = Symbol("fireBlocked");

// IDBDatabase
export const kConnection = Symbol("connection");
export const kClosed = Symbol("closed");
export const kUpgradeTx = Symbol("upgradeTx");
export const kGetStoreMeta = Symbol("getStoreMeta");
export const kRefreshStoreNames = Symbol("refreshStoreNames");
export const kSetVersion = Symbol("setVersion");
export const kSetOnClose = Symbol("setOnClose");
export const kFinishClose = Symbol("finishClose");

// IDBTransaction
export const kScope = Symbol("scope");
export const kParent = Symbol("parent");
export const kBackendTx = Symbol("backendTx");
export const kOnDone = Symbol("onDone");
export const kOnSyncAbort = Symbol("onSyncAbort");
export const kStart = Symbol("start");
export const kAborted = Symbol("aborted");
export const kActive = Symbol("active");
export const kFinished = Symbol("finished");
export const kExecuteRequest = Symbol("executeRequest");
export const kAbortWithError = Symbol("abortWithError");
export const kRenameStoreInCache = Symbol("renameStoreInCache");
export const kRecordIndexRename = Symbol("recordIndexRename");
export const kScheduleAutoCommit = Symbol("scheduleAutoCommit");
export const kScheduleDeactivation = Symbol("scheduleDeactivation");
export const kDeactivate = Symbol("deactivate");
export const kHoldOpen = Symbol("holdOpen");
export const kRelease = Symbol("release");

// IDBObjectStore
export const kDeleted = Symbol("deleted");
export const kIndexNames = Symbol("indexNames");
export const kIndexInstances = Symbol("indexInstances");
export const kRevertName = Symbol("revertName");

// IDBKeyRange
export const kToSpec = Symbol("toSpec");
