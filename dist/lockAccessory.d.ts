import type { PlatformAccessory } from 'homebridge';
import type { TTLockApiClient } from './api-client';
import type { TTLockPlatform } from './platform';
import type { TTLockRawLock } from './types';
interface LockContext {
    lockId: number;
    keyId: number;
    name: string;
}
export declare class TTLockAccessory {
    private readonly platform;
    readonly accessory: PlatformAccessory<LockContext>;
    private lock;
    private readonly apiClient;
    private readonly lockService;
    private readonly batteryService;
    private currentLockState;
    private targetLockState;
    private batteryLevel;
    private actionInFlight?;
    private stateRefreshInFlight?;
    private batteryRefreshInFlight?;
    private remoteControlAvailable;
    private remoteControlBlockedLogged;
    private lastStateWarningKey;
    private lastStateWarningAt;
    private lastBatteryWarningKey;
    private lastBatteryWarningAt;
    constructor(platform: TTLockPlatform, accessory: PlatformAccessory<LockContext>, lock: TTLockRawLock, apiClient: TTLockApiClient);
    syncFromLock(lock: TTLockRawLock): void;
    getDisplayName(): string;
    refreshLockState(): Promise<void>;
    refreshBattery(): Promise<void>;
    private applyMetadata;
    private refreshLockStateInternal;
    private refreshBatteryInternal;
    private handleGetCurrentLockState;
    private handleGetTargetLockState;
    private handleGetBatteryLevel;
    private handleSetTargetLockState;
    private performTargetLockStateChange;
    private shouldSuppressStateRefreshError;
    private shouldSuppressBatteryRefreshError;
    private logStateWarning;
    private clearStateWarning;
    private logBatteryWarning;
    private clearBatteryWarning;
    private errorToMessage;
    private getLowBatteryStatus;
}
export declare function createAccessoryContext(lock: TTLockRawLock): {
    platform: string;
    lockId: number;
    keyId: number;
    name: string;
};
export {};
