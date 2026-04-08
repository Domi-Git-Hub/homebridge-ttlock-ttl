export interface TTLockPlatformConfig {
    username?: string;
    password?: string;
    pollerSeconds?: number;
    lowBatteryThreshold?: number;
    maxApiRetries?: number;
    requestTimeoutMs?: number;
    retryDelayMs?: number;
    refreshDelayAfterActionMs?: number;
    hideLocks?: string[] | string;
}
export interface TTLockSession {
    accessToken: string;
    userId: string;
}
export interface TTLockRawLock {
    lockId: number;
    keyId?: number;
    lockName?: string;
    lockAlias?: string;
    electricQuantity?: number;
    modelNum?: string;
    hardwareRevision?: string;
    firmwareRevision?: string;
}
export interface TTLockListResponse {
    list?: TTLockRawLock[];
    rows?: TTLockRawLock[];
    items?: TTLockRawLock[];
    records?: TTLockRawLock[];
    pageNum?: number;
    pageSize?: number;
    pages?: number;
    total?: number;
    data?: {
        list?: TTLockRawLock[];
        rows?: TTLockRawLock[];
        items?: TTLockRawLock[];
        records?: TTLockRawLock[];
        pageVo?: {
            list?: TTLockRawLock[];
        };
    };
    pageVo?: {
        list?: TTLockRawLock[];
    };
}
export interface TTLockStateResponse {
    state?: number | string;
    lockState?: number | string;
    openState?: number | string;
    status?: number | string;
    data?: {
        state?: number | string;
        lockState?: number | string;
        openState?: number | string;
        status?: number | string;
    };
}
export interface TTLockBatteryResponse {
    electricQuantity?: number | string;
    battery?: number | string;
    data?: {
        electricQuantity?: number | string;
        battery?: number | string;
    };
}
export interface TTLockLoginResponse {
    accessToken?: string;
    access_token?: string;
    token?: string;
    userId?: number | string;
    uid?: number | string;
    userID?: number | string;
    UserId?: number | string;
    user?: {
        userId?: number | string;
        uid?: number | string;
    };
    data?: {
        accessToken?: string;
        access_token?: string;
        token?: string;
        userId?: number | string;
        uid?: number | string;
        user?: {
            userId?: number | string;
            uid?: number | string;
        };
    };
}
export interface TTLockCommandResponse {
    code?: number;
    msg?: string;
    errcode?: number;
    errmsg?: string;
    description?: string;
}
export type LockStateKind = 'secured' | 'unsecured' | 'unknown';
