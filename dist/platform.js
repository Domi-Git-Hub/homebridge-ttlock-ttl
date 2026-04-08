"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TTLockPlatform = void 0;
const settings_1 = require("./settings");
const lockAccessory_1 = require("./lockAccessory");
const api_client_1 = require("./api-client");
class TTLockPlatform {
    log;
    api;
    Service;
    Characteristic;
    accessories = new Map();
    activeLocks = new Map();
    config;
    apiClient;
    pollTimer;
    launchCompleted = false;
    pollCycleInFlight;
    pollingPauseCount = 0;
    constructor(log, config, api) {
        this.log = log;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.config = this.normalizeConfig(config);
        this.apiClient = new api_client_1.TTLockApiClient(this.log, this.config);
        if (!this.isConfigured()) {
            this.log.warn(`[${settings_1.PLATFORM_DISPLAY_NAME}] Plugin loaded but not started because username/password are missing.`);
            return;
        }
        this.api.on('didFinishLaunching', () => {
            void this.didFinishLaunching();
        });
    }
    configureAccessory(accessory) {
        this.accessories.set(accessory.UUID, accessory);
    }
    async runWithPollingPaused(operation) {
        this.pausePolling();
        try {
            return await operation();
        }
        finally {
            this.resumePolling();
        }
    }
    async refreshAllLockStates() {
        for (const lockAccessory of this.activeLocks.values()) {
            try {
                await lockAccessory.refreshLockState();
            }
            catch (error) {
                this.log.warn(`[${lockAccessory.getDisplayName()}] State poll failed: ${this.errorToMessage(error)}`);
            }
        }
    }
    async refreshAllBatteries() {
        for (const lockAccessory of this.activeLocks.values()) {
            try {
                await lockAccessory.refreshBattery();
            }
            catch (error) {
                this.log.warn(`[${lockAccessory.getDisplayName()}] Battery poll failed: ${this.errorToMessage(error)}`);
            }
        }
    }
    async didFinishLaunching() {
        if (this.launchCompleted) {
            return;
        }
        this.launchCompleted = true;
        await this.discoverLocksOnce();
        await this.runPollingCycle();
        this.startPoller();
    }
    async discoverLocksOnce() {
        try {
            const locks = await this.apiClient.listLocks();
            this.syncAccessoriesFromLocks(locks);
        }
        catch (error) {
            this.log.error(`[${settings_1.PLATFORM_DISPLAY_NAME}] Initial lock discovery failed: ${this.errorToMessage(error)}`);
        }
    }
    async runPollingCycle() {
        if (!this.pollCycleInFlight) {
            this.pollCycleInFlight = this.runPollingCycleInternal()
                .finally(() => {
                this.pollCycleInFlight = undefined;
            });
        }
        await this.pollCycleInFlight;
    }
    async runPollingCycleInternal() {
        try {
            await this.refreshAllLockStates();
            await this.refreshAllBatteries();
        }
        catch (error) {
            this.log.error(`[${settings_1.PLATFORM_DISPLAY_NAME}] Polling cycle failed: ${this.errorToMessage(error)}`);
        }
    }
    syncAccessoriesFromLocks(locks) {
        const seenUuids = new Set();
        const currentLockIds = new Set();
        for (const lock of locks) {
            const name = lock.lockAlias?.trim() || lock.lockName?.trim() || `TTLock ${lock.lockId}`;
            const uuid = this.api.hap.uuid.generate(`${settings_1.PLATFORM_NAME}-${lock.lockId}`);
            const existingAccessory = this.accessories.get(uuid);
            const existingWrapper = this.activeLocks.get(lock.lockId);
            seenUuids.add(uuid);
            currentLockIds.add(lock.lockId);
            if (existingWrapper) {
                existingWrapper.syncFromLock(lock);
                if (existingAccessory && existingAccessory.displayName !== name) {
                    existingAccessory.displayName = name;
                    this.api.updatePlatformAccessories([existingAccessory]);
                }
                continue;
            }
            if (existingAccessory) {
                existingAccessory.displayName = name;
                const wrapper = new lockAccessory_1.TTLockAccessory(this, existingAccessory, lock, this.apiClient);
                this.activeLocks.set(lock.lockId, wrapper);
                this.api.updatePlatformAccessories([existingAccessory]);
                this.log.info(`[${name}] Restored existing accessory.`);
            }
            else {
                const accessory = new this.api.platformAccessory(name, uuid);
                accessory.context = (0, lockAccessory_1.createAccessoryContext)(lock);
                const wrapper = new lockAccessory_1.TTLockAccessory(this, accessory, lock, this.apiClient);
                this.accessories.set(uuid, accessory);
                this.activeLocks.set(lock.lockId, wrapper);
                this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
                this.log.info(`[${name}] Added new accessory.`);
            }
        }
        const staleAccessories = [...this.accessories.entries()]
            .filter(([uuid]) => !seenUuids.has(uuid))
            .map(([, accessory]) => accessory);
        if (staleAccessories.length > 0) {
            for (const accessory of staleAccessories) {
                this.accessories.delete(accessory.UUID);
                const lockId = Number(accessory.context.lockId ?? 0);
                this.activeLocks.delete(lockId);
            }
            this.api.unregisterPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, staleAccessories);
            this.log.info(`Removed ${staleAccessories.length} stale accessory(s).`);
        }
        for (const lockId of [...this.activeLocks.keys()]) {
            if (!currentLockIds.has(lockId)) {
                this.activeLocks.delete(lockId);
            }
        }
    }
    startPoller() {
        this.schedulePoll(this.config.pollerSeconds * 1000);
        this.log.info(`[${settings_1.PLATFORM_DISPLAY_NAME}] Polling enabled: lock state + battery every ${this.config.pollerSeconds}s after each completed cycle.`);
    }
    pausePolling() {
        this.pollingPauseCount += 1;
        if (this.pollingPauseCount === 1) {
            this.clearPollingTimer();
        }
    }
    resumePolling() {
        if (this.pollingPauseCount <= 0) {
            this.pollingPauseCount = 0;
            return;
        }
        this.pollingPauseCount -= 1;
        if (this.pollingPauseCount === 0) {
            this.schedulePoll(this.config.pollerSeconds * 1000);
        }
    }
    isPollingPaused() {
        return this.pollingPauseCount > 0;
    }
    clearPollingTimer() {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = undefined;
        }
    }
    schedulePoll(delayMs) {
        if (this.isPollingPaused() || this.pollTimer) {
            return;
        }
        this.pollTimer = setTimeout(() => {
            this.pollTimer = undefined;
            void this.runScheduledPollCycle();
        }, Math.max(0, delayMs));
        this.pollTimer?.unref?.();
    }
    async runScheduledPollCycle() {
        if (this.isPollingPaused()) {
            return;
        }
        try {
            await this.runPollingCycle();
        }
        finally {
            if (!this.isPollingPaused()) {
                this.schedulePoll(this.config.pollerSeconds * 1000);
            }
        }
    }
    normalizeConfig(config) {
        return {
            username: config.username?.trim() ?? '',
            password: config.password?.trim() ?? '',
            pollerSeconds: this.numberOrDefault(config.pollerSeconds, settings_1.DEFAULTS.pollerSeconds, 1, 86400),
            lowBatteryThreshold: this.numberOrDefault(config.lowBatteryThreshold, settings_1.DEFAULTS.lowBatteryThreshold, 1, 100),
            maxApiRetries: this.numberOrDefault(config.maxApiRetries, settings_1.DEFAULTS.maxApiRetries, 1, 10),
            requestTimeoutMs: this.numberOrDefault(config.requestTimeoutMs, settings_1.DEFAULTS.requestTimeoutMs, 1000, 120000),
            retryDelayMs: this.numberOrDefault(config.retryDelayMs, settings_1.DEFAULTS.retryDelayMs, 0, 60000),
            refreshDelayAfterActionMs: this.numberOrDefault(config.refreshDelayAfterActionMs, settings_1.DEFAULTS.refreshDelayAfterActionMs, 0, 120000),
            hideLocks: this.parseHideLocks(config.hideLocks),
        };
    }
    isConfigured() {
        return this.config.username.length > 0 && this.config.password.length > 0;
    }
    numberOrDefault(value, fallback, min, max) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, Math.round(numeric)));
    }
    parseHideLocks(value) {
        if (Array.isArray(value)) {
            return value.map((entry) => String(entry).trim()).filter(Boolean);
        }
        if (typeof value === 'string') {
            return value
                .split(/[\n,;]/)
                .map((entry) => entry.trim())
                .filter(Boolean);
        }
        return [];
    }
    errorToMessage(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
exports.TTLockPlatform = TTLockPlatform;
//# sourceMappingURL=platform.js.map