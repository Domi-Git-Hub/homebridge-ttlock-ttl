"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TTLockAccessory = void 0;
exports.createAccessoryContext = createAccessoryContext;
const settings_1 = require("./settings");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class TTLockAccessory {
    platform;
    accessory;
    lock;
    apiClient;
    lockService;
    batteryService;
    currentLockState;
    targetLockState;
    batteryLevel = 100;
    actionInFlight;
    stateRefreshInFlight;
    batteryRefreshInFlight;
    remoteControlAvailable = true;
    remoteControlBlockedLogged = false;
    lastStateWarningKey = '';
    lastStateWarningAt = 0;
    lastBatteryWarningKey = '';
    lastBatteryWarningAt = 0;
    constructor(platform, accessory, lock, apiClient) {
        this.platform = platform;
        this.accessory = accessory;
        this.lock = lock;
        this.apiClient = apiClient;
        const name = this.getDisplayName();
        const keyId = Number(lock.keyId);
        if (!Number.isFinite(keyId)) {
            throw new Error(`Lock ${name} (${lock.lockId}) is missing keyId.`);
        }
        this.currentLockState = this.platform.Characteristic.LockCurrentState.SECURED;
        this.targetLockState = this.platform.Characteristic.LockTargetState.SECURED;
        accessory.context.lockId = lock.lockId;
        accessory.context.keyId = keyId;
        accessory.context.name = name;
        this.lockService = accessory.getService(this.platform.Service.LockMechanism)
            ?? accessory.addService(this.platform.Service.LockMechanism, name);
        this.batteryService = accessory.getService(this.platform.Service.Battery)
            ?? accessory.addService(this.platform.Service.Battery, `${name} Battery`);
        this.applyMetadata();
        this.lockService.getCharacteristic(this.platform.Characteristic.LockCurrentState)
            .onGet(this.handleGetCurrentLockState.bind(this));
        this.lockService.getCharacteristic(this.platform.Characteristic.LockTargetState)
            .onGet(this.handleGetTargetLockState.bind(this))
            .onSet(this.handleSetTargetLockState.bind(this));
        this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel)
            .onGet(this.handleGetBatteryLevel.bind(this));
        this.batteryService.getCharacteristic(this.platform.Characteristic.ChargingState)
            .onGet(() => this.platform.Characteristic.ChargingState.NOT_CHARGEABLE);
        this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
            .onGet(() => this.getLowBatteryStatus());
    }
    syncFromLock(lock) {
        this.lock = lock;
        this.accessory.context.lockId = lock.lockId;
        this.accessory.context.keyId = Number(lock.keyId ?? 0);
        this.accessory.context.name = this.getDisplayName();
        this.accessory.displayName = this.getDisplayName();
        this.applyMetadata();
    }
    getDisplayName() {
        return this.lock.alias?.trim() || this.lock.name?.trim() || `TTLock ${this.lock.lockId}`;
    }
    async refreshLockState() {
        if (this.actionInFlight) {
            await this.actionInFlight;
            return;
        }
        if (!this.stateRefreshInFlight) {
            this.stateRefreshInFlight = this.refreshLockStateInternal()
                .finally(() => {
                this.stateRefreshInFlight = undefined;
            });
        }
        await this.stateRefreshInFlight;
    }
    async refreshBattery() {
        if (!this.batteryRefreshInFlight) {
            this.batteryRefreshInFlight = this.refreshBatteryInternal()
                .finally(() => {
                this.batteryRefreshInFlight = undefined;
            });
        }
        await this.batteryRefreshInFlight;
    }
    applyMetadata() {
        const name = this.getDisplayName();
        this.accessory.getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'TTLock')
            .setCharacteristic(this.platform.Characteristic.Model, this.lock.modelNum ?? 'TTLock Smart Lock')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, String(this.lock.lockId))
            .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.lock.firmwareRevision ?? 'unknown')
            .setCharacteristic(this.platform.Characteristic.HardwareRevision, this.lock.hardwareRevision ?? 'unknown')
            .setCharacteristic(this.platform.Characteristic.Name, name);
        this.lockService.setCharacteristic(this.platform.Characteristic.Name, name);
        this.batteryService.setCharacteristic(this.platform.Characteristic.Name, `${name} Battery`);
    }
    async refreshLockStateInternal() {
        try {
            const result = await this.apiClient.queryLockState(this.lock.lockId);
            this.clearStateWarning();
            if (result.state === 'unknown') {
                this.logStateWarning(`Unknown lock state received from API: ${String(result.rawState)}`);
                return;
            }
            this.currentLockState = result.state === 'secured'
                ? this.platform.Characteristic.LockCurrentState.SECURED
                : this.platform.Characteristic.LockCurrentState.UNSECURED;
            this.targetLockState = this.currentLockState === this.platform.Characteristic.LockCurrentState.SECURED
                ? this.platform.Characteristic.LockTargetState.SECURED
                : this.platform.Characteristic.LockTargetState.UNSECURED;
            this.lockService.updateCharacteristic(this.platform.Characteristic.LockCurrentState, this.currentLockState);
            this.lockService.updateCharacteristic(this.platform.Characteristic.LockTargetState, this.targetLockState);
        }
        catch (error) {
            const message = this.errorToMessage(error);
            if (this.shouldSuppressStateRefreshError(message)) {
                this.logStateWarning(message);
                return;
            }
            throw error;
        }
    }
    async refreshBatteryInternal() {
        try {
            this.batteryLevel = await this.apiClient.queryBattery(this.lock.lockId);
            this.clearBatteryWarning();
            this.batteryService.updateCharacteristic(this.platform.Characteristic.BatteryLevel, this.batteryLevel);
            this.batteryService.updateCharacteristic(this.platform.Characteristic.StatusLowBattery, this.getLowBatteryStatus());
            this.batteryService.updateCharacteristic(this.platform.Characteristic.ChargingState, this.platform.Characteristic.ChargingState.NOT_CHARGEABLE);
        }
        catch (error) {
            const message = this.errorToMessage(error);
            if (this.shouldSuppressBatteryRefreshError(message)) {
                this.logBatteryWarning(message);
                return;
            }
            throw error;
        }
    }
    async handleGetCurrentLockState() {
        return this.platform.runWithPollingPaused(async () => {
            try {
                await this.refreshLockState();
            }
            catch (error) {
                this.logStateWarning(this.errorToMessage(error));
            }
            return this.currentLockState;
        });
    }
    async handleGetTargetLockState() {
        return this.platform.runWithPollingPaused(async () => {
            try {
                await this.refreshLockState();
            }
            catch (error) {
                this.logStateWarning(this.errorToMessage(error));
            }
            return this.targetLockState;
        });
    }
    async handleGetBatteryLevel() {
        return this.platform.runWithPollingPaused(async () => {
            try {
                await this.refreshBattery();
            }
            catch (error) {
                this.logBatteryWarning(this.errorToMessage(error));
            }
            return this.batteryLevel;
        });
    }
    async handleSetTargetLockState(value) {
        const desiredState = Number(value) === this.platform.Characteristic.LockTargetState.UNSECURED
            ? this.platform.Characteristic.LockTargetState.UNSECURED
            : this.platform.Characteristic.LockTargetState.SECURED;
        if (!this.remoteControlAvailable) {
            this.targetLockState = this.currentLockState === this.platform.Characteristic.LockCurrentState.SECURED
                ? this.platform.Characteristic.LockTargetState.SECURED
                : this.platform.Characteristic.LockTargetState.UNSECURED;
            this.lockService.updateCharacteristic(this.platform.Characteristic.LockTargetState, this.targetLockState);
            return;
        }
        await this.platform.runWithPollingPaused(async () => {
            if (!this.actionInFlight) {
                this.actionInFlight = this.performTargetLockStateChange(desiredState)
                    .finally(() => {
                    this.actionInFlight = undefined;
                });
            }
            await this.actionInFlight;
        });
    }
    async performTargetLockStateChange(desiredState) {
        const isUnlock = desiredState === this.platform.Characteristic.LockTargetState.UNSECURED;
        const action = isUnlock ? 'unlock' : 'lock';
        const previousTargetState = this.targetLockState;
        this.targetLockState = desiredState;
        this.lockService.updateCharacteristic(this.platform.Characteristic.LockTargetState, this.targetLockState);
        this.platform.log.info(`[${this.getDisplayName()}] Requesting ${action}.`);
        try {
            if (isUnlock) {
                await this.apiClient.unlock(this.accessory.context.keyId);
            }
            else {
                await this.apiClient.lock(this.accessory.context.keyId);
            }
            await sleep(this.platform.config.refreshDelayAfterActionMs);
            await this.refreshLockStateInternal();
        }
        catch (error) {
            const message = this.errorToMessage(error);
            if (message.toLowerCase().includes('remote control lock is closed')) {
                this.remoteControlAvailable = false;
                if (!this.remoteControlBlockedLogged) {
                    this.remoteControlBlockedLogged = true;
                    this.logWarn(`[${this.getDisplayName()}] Remote control is disabled for this lock/account on the TTLock server. Commands will be ignored until the plugin is restarted after enabling remote control.`);
                }
            }
            else {
                this.logWarn(`[${this.getDisplayName()}] ${action} failed: ${message}`);
            }
            this.targetLockState = this.currentLockState === this.platform.Characteristic.LockCurrentState.SECURED
                ? this.platform.Characteristic.LockTargetState.SECURED
                : this.platform.Characteristic.LockTargetState.UNSECURED;
            this.lockService.updateCharacteristic(this.platform.Characteristic.LockCurrentState, this.currentLockState);
            this.lockService.updateCharacteristic(this.platform.Characteristic.LockTargetState, this.targetLockState ?? previousTargetState);
        }
    }
    shouldSuppressStateRefreshError(message) {
        const normalized = message.toLowerCase();
        return normalized.includes('failed to obtain lock status')
            || normalized.includes('operation was aborted')
            || normalized.includes('timeout')
            || normalized.includes('timed out');
    }
    shouldSuppressBatteryRefreshError(message) {
        const normalized = message.toLowerCase();
        return normalized.includes('operation was aborted') || normalized.includes('timeout') || normalized.includes('timed out');
    }
    logStateWarning(message) {
        const now = Date.now();
        if (this.lastStateWarningKey === message && (now - this.lastStateWarningAt) < 60000) {
            return;
        }
        this.lastStateWarningKey = message;
        this.lastStateWarningAt = now;
        this.logWarn(`[${this.getDisplayName()}] State refresh unavailable, keeping last known state: ${message}`);
    }
    clearStateWarning() {
        this.lastStateWarningKey = '';
        this.lastStateWarningAt = 0;
    }
    logBatteryWarning(message) {
        const now = Date.now();
        if (this.lastBatteryWarningKey === message && (now - this.lastBatteryWarningAt) < 60000) {
            return;
        }
        this.lastBatteryWarningKey = message;
        this.lastBatteryWarningAt = now;
        this.logWarn(`[${this.getDisplayName()}] Battery refresh unavailable, keeping last known battery value: ${message}`);
    }
    clearBatteryWarning() {
        this.lastBatteryWarningKey = '';
        this.lastBatteryWarningAt = 0;
    }
    shouldLogProblems() {
        return Boolean(this.platform.config.debug);
    }
    logWarn(message) {
        if (this.shouldLogProblems()) {
            this.platform.log.warn(message);
        }
    }
    errorToMessage(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
    getLowBatteryStatus() {
        return this.batteryLevel <= this.platform.config.lowBatteryThreshold
            ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }
}
exports.TTLockAccessory = TTLockAccessory;
function createAccessoryContext(lock) {
    return {
        platform: settings_1.PLATFORM_NAME,
        lockId: lock.lockId,
        keyId: Number(lock.keyId ?? 0),
        name: lock.lockAlias?.trim() || lock.lockName?.trim() || `TTLock ${lock.lockId}`,
    };
}
//# sourceMappingURL=lockAccessory.js.map