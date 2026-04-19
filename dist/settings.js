"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TTLOCK_BASE_URL = exports.DEFAULTS = exports.PLATFORM_DISPLAY_NAME = exports.PLATFORM_NAME = exports.PLUGIN_NAME = void 0;
exports.PLUGIN_NAME = 'homebridge-ttlock-ttl';
exports.PLATFORM_NAME = 'TTLockTTL';
exports.PLATFORM_DISPLAY_NAME = 'TTLock/TTL';
exports.DEFAULTS = {
    pollerSeconds: 20,
    lowBatteryThreshold: 20,
    maxApiRetries: 3,
    requestTimeoutMs: 10000,
    retryDelayMs: 1000,
    refreshDelayAfterActionMs: 3000,
    debug: false,
};
exports.TTLOCK_BASE_URL = 'http://onpremise.ttlock.com';
//# sourceMappingURL=settings.js.map