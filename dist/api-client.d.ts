import type { LockStateKind, TTLockPlatformConfig, TTLockRawLock } from './types';
interface LoggerLike {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
export declare class TTLockApiClient {
    private readonly log;
    private readonly config;
    private readonly hiddenLocks;
    private session?;
    private loginPromise?;
    private operationQueue;
    private lastVisibleLockCount?;
    constructor(log: LoggerLike, config: Required<TTLockPlatformConfig>);
    listLocks(): Promise<TTLockRawLock[]>;
    private listLocksInternal;
    queryLockState(lockId: number): Promise<{
        state: LockStateKind;
        rawState: number | string | undefined;
    }>;
    queryBattery(lockId: number): Promise<number>;
    lock(keyId: number): Promise<void>;
    unlock(keyId: number): Promise<void>;
    clearSession(): void;
    private enqueueOperation;
    private control;
    private isHidden;
    private requestWithRetry;
    private request;
    private buildUrl;
    private ensureSession;
    private login;
    private extractAccessToken;
    private extractUserId;
    private extractLocks;
    private extractLockStateValue;
    private extractBatteryValue;
    private normalizedPasswordMd5;
    private parseLockState;
    private looksLikeInvalidTokenPayload;
    private looksLikeGenericErrorPayload;
    private isInvalidTokenError;
    private isAbortError;
    private isTimeoutError;
    private errorToMessage;
}
export {};
