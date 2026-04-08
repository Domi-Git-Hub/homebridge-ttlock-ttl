export declare const PLUGIN_NAME = "homebridge-ttlock-ttl";
export declare const PLATFORM_NAME = "TTLockTTL";
export declare const PLATFORM_DISPLAY_NAME = "TTLock/TTL";
export declare const DEFAULTS: {
    readonly pollerSeconds: 20;
    readonly lowBatteryThreshold: 20;
    readonly maxApiRetries: 3;
    readonly requestTimeoutMs: 10000;
    readonly retryDelayMs: 1000;
    readonly refreshDelayAfterActionMs: 3000;
};
export declare const TTLOCK_BASE_URL = "http://onpremise.ttlock.com";
