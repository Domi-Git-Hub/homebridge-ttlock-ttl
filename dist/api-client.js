"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TTLockApiClient = void 0;
const crypto_1 = require("crypto");
const settings_1 = require("./settings");
class TTLockApiError extends Error {
    path;
    payload;
    status;
    constructor(message, path, payload, status) {
        super(message);
        this.path = path;
        this.payload = payload;
        this.status = status;
        this.name = 'TTLockApiError';
    }
}
class TTLockTimeoutError extends Error {
    timeoutMs;
    path;
    constructor(timeoutMs, path) {
        super(`Request timed out after ${timeoutMs} ms`);
        this.timeoutMs = timeoutMs;
        this.path = path;
        this.name = 'TTLockTimeoutError';
    }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class TTLockApiClient {
    log;
    config;
    hiddenLocks;
    session;
    loginPromise;
    operationQueue = Promise.resolve();
    lastVisibleLockCount;
    constructor(log, config) {
        this.log = log;
        this.config = config;
        const hiddenLocks = Array.isArray(config.hideLocks)
            ? config.hideLocks
            : typeof config.hideLocks === 'string'
                ? config.hideLocks.split(/[\n,;]/)
                : [];
        this.hiddenLocks = new Set(hiddenLocks.map((value) => value.trim().toLowerCase()).filter(Boolean));
    }
    async listLocks() {
        return this.enqueueOperation(() => this.listLocksInternal());
    }
    async listLocksInternal() {
        const locks = [];
        let pageNum = 1;
        const pageSize = 50;
        while (true) {
            const response = await this.requestWithRetry({
                method: 'GET',
                path: '/lock/listByUser',
                params: {
                    pageNum,
                    pageSize,
                    groupId: '',
                    searchStr: '',
                    notGrade: 2,
                    type: 1,
                },
            }, `list locks page ${pageNum}`);
            const pageLocks = this.extractLocks(response);
            this.log.debug(`[TTLock API] list locks page ${pageNum}: ${pageLocks.length} lock(s) returned.`);
            locks.push(...pageLocks);
            if (pageLocks.length < pageSize) {
                break;
            }
            pageNum += 1;
        }
        const visibleLocks = locks.filter((lock) => !this.isHidden(lock));
        if (this.lastVisibleLockCount !== visibleLocks.length) {
            this.log.info(`[TTLock API] total visible locks discovered: ${visibleLocks.length}.`);
            this.lastVisibleLockCount = visibleLocks.length;
        }
        else {
            this.log.debug(`[TTLock API] total visible locks discovered: ${visibleLocks.length}.`);
        }
        return visibleLocks;
    }
    async queryLockState(lockId) {
        return this.enqueueOperation(async () => {
            const response = await this.requestWithRetry({
                method: 'GET',
                path: '/lock/queryState',
                params: { lockId },
            }, `query lock state for ${lockId}`);
            const rawState = this.extractLockStateValue(response);
            return {
                rawState,
                state: this.parseLockState(rawState),
            };
        });
    }
    async queryBattery(lockId) {
        return this.enqueueOperation(async () => {
            const response = await this.requestWithRetry({
                method: 'GET',
                path: '/lock/getElectricQuantity',
                params: { lockId, byGateway: 0 },
            }, `query battery for ${lockId}`);
            const rawBattery = this.extractBatteryValue(response);
            const battery = Number(rawBattery);
            if (!Number.isFinite(battery)) {
                throw new Error(`Invalid battery value received for lock ${lockId}: ${String(rawBattery)}`);
            }
            return Math.max(0, Math.min(100, Math.round(battery)));
        });
    }
    async lock(keyId) {
        await this.enqueueOperation(() => this.control(keyId, 2, 'lock'));
    }
    async unlock(keyId) {
        await this.enqueueOperation(() => this.control(keyId, 1, 'unlock'));
    }
    clearSession() {
        this.session = undefined;
    }
    async enqueueOperation(operation) {
        const previous = this.operationQueue;
        let release;
        this.operationQueue = new Promise((resolve) => {
            release = resolve;
        });
        await previous.catch(() => undefined);
        try {
            return await operation();
        }
        finally {
            release();
        }
    }
    async control(keyId, type, action) {
        const response = await this.requestWithRetry({
            method: 'POST',
            path: '/key/control',
            body: new URLSearchParams({
                type: String(type),
                keyId: String(keyId),
            }),
        }, `${action} by keyId ${keyId}`);
        const commandCode = response.code ?? response.errcode ?? 0;
        if (Number(commandCode) !== 0) {
            throw new Error(`TTLock ${action} failed: ${response.msg ?? response.errmsg ?? response.description ?? `code ${commandCode}`}`);
        }
    }
    isHidden(lock) {
        const identifiers = [
            String(lock.lockId),
            lock.lockAlias ?? '',
            lock.lockName ?? '',
        ].map((value) => value.trim().toLowerCase()).filter(Boolean);
        return identifiers.some((value) => this.hiddenLocks.has(value));
    }
    async requestWithRetry(request, label) {
        let attempt = 0;
        let lastError;
        while (attempt < this.config.maxApiRetries) {
            attempt += 1;
            try {
                return await this.request(request);
            }
            catch (error) {
                lastError = error;
                const invalidToken = this.isInvalidTokenError(error);
                const timedOut = this.isTimeoutError(error);
                if (timedOut) {
                    this.log.debug(`[TTLock API] ${label} timed out on attempt ${attempt}/${this.config.maxApiRetries}.`);
                }
                else {
                    this.log.warn(`[TTLock API] ${label} failed on attempt ${attempt}/${this.config.maxApiRetries}: ${this.errorToMessage(error)}`);
                }
                if (invalidToken) {
                    this.log.info('[TTLock API] Access token expired or invalid, requesting a fresh session.');
                    this.clearSession();
                }
                if (attempt >= this.config.maxApiRetries) {
                    break;
                }
                await sleep(this.config.retryDelayMs);
            }
        }
        throw new Error(`[TTLock API] ${label} failed after ${Math.max(1, attempt)} attempt(s): ${this.errorToMessage(lastError)}`);
    }
    async request(request) {
        const session = request.withAuth === false ? undefined : await this.ensureSession();
        const url = this.buildUrl(request.path, request.params);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
        try {
            const response = await fetch(url, {
                method: request.method,
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    Connection: 'keep-alive',
                    lang: 'en',
                    platform: '2',
                    ...(request.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
                    ...(session ? {
                        accessToken: session.accessToken,
                        userId: session.userId,
                    } : { accessToken: 'null' }),
                },
                body: request.body?.toString(),
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new TTLockApiError(`HTTP ${response.status}`, request.path, undefined, response.status);
            }
            const payload = await response.json();
            if (this.looksLikeInvalidTokenPayload(payload)) {
                throw new TTLockApiError(payload.msg ?? payload.errmsg ?? 'Invalid token', request.path, payload, response.status);
            }
            if (this.looksLikeGenericErrorPayload(payload)) {
                throw new TTLockApiError(payload.msg ?? payload.errmsg ?? payload.description ?? 'TTLock API error', request.path, payload, response.status);
            }
            return payload;
        }
        catch (error) {
            if (this.isAbortError(error)) {
                throw new TTLockTimeoutError(this.config.requestTimeoutMs, request.path);
            }
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    buildUrl(path, params) {
        const url = new URL(path, settings_1.TTLOCK_BASE_URL);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                url.searchParams.set(key, String(value));
            }
        }
        return url.toString();
    }
    async ensureSession() {
        if (this.session) {
            return this.session;
        }
        if (!this.loginPromise) {
            this.loginPromise = this.login();
        }
        try {
            this.session = await this.loginPromise;
            return this.session;
        }
        finally {
            this.loginPromise = undefined;
        }
    }
    async login() {
        const passwordMd5 = this.normalizedPasswordMd5(this.config.password);
        this.log.info('[TTLock API] Logging in to obtain a fresh access token.');
        const response = await this.request({
            method: 'POST',
            path: '/user/login',
            body: new URLSearchParams({
                account: this.config.username,
                password: passwordMd5,
            }),
            withAuth: false,
        });
        const accessToken = this.extractAccessToken(response);
        const userId = this.extractUserId(response);
        if (!accessToken || !userId) {
            const keys = Object.keys(response ?? {}).sort().join(', ');
            throw new Error(`Login did not return a usable token and user id. Available login response keys: ${keys || 'none'}`);
        }
        return { accessToken, userId };
    }
    extractAccessToken(response) {
        const candidates = [
            response.accessToken,
            response.access_token,
            response.token,
            response.data?.accessToken,
            response.data?.access_token,
            response.data?.token,
        ];
        for (const value of candidates) {
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
        return '';
    }
    extractUserId(response) {
        const candidates = [
            response.userId,
            response.uid,
            response.userID,
            response.UserId,
            response.user?.userId,
            response.user?.uid,
            response.data?.userId,
            response.data?.uid,
            response.data?.user?.userId,
            response.data?.user?.uid,
        ];
        for (const value of candidates) {
            if (value !== undefined && value !== null && String(value).trim()) {
                return String(value).trim();
            }
        }
        return '';
    }
    extractLocks(response) {
        const candidates = [
            response.list,
            response.rows,
            response.items,
            response.records,
            response.data?.list,
            response.data?.rows,
            response.data?.items,
            response.data?.records,
            response.pageVo?.list,
            response.data?.pageVo?.list,
        ];
        for (const value of candidates) {
            if (Array.isArray(value)) {
                return value;
            }
        }
        const keys = Object.keys(response ?? {}).sort().join(', ');
        this.log.warn(`[TTLock API] list locks response did not expose a known list field. Available keys: ${keys || 'none'}`);
        return [];
    }
    extractLockStateValue(response) {
        const data = response.data;
        return response.state
            ?? response.lockState
            ?? response.openState
            ?? response.status
            ?? data?.state
            ?? data?.lockState
            ?? data?.openState
            ?? data?.status;
    }
    extractBatteryValue(response) {
        const data = response.data;
        return response.electricQuantity
            ?? response.battery
            ?? data?.electricQuantity
            ?? data?.battery;
    }
    normalizedPasswordMd5(value) {
        const trimmed = value.trim();
        if (/^[a-fA-F0-9]{32}$/.test(trimmed)) {
            return trimmed.toLowerCase();
        }
        this.log.warn('[TTLock API] Password is not a 32-character MD5 hash. Hashing the provided value automatically.');
        return (0, crypto_1.createHash)('md5').update(trimmed).digest('hex');
    }
    parseLockState(rawState) {
        if (typeof rawState === 'number') {
            switch (rawState) {
                case 0:
                    return 'secured';
                case 1:
                    return 'unsecured';
                default:
                    return 'unknown';
            }
        }
        if (typeof rawState === 'string') {
            const normalized = rawState.trim().toLowerCase();
            if (normalized === '0' || normalized === 'locked' || normalized.includes('locked')) {
                return 'secured';
            }
            if (normalized === '1' || normalized === 'unlocked' || normalized.includes('unlock')) {
                return 'unsecured';
            }
        }
        return 'unknown';
    }
    looksLikeInvalidTokenPayload(payload) {
        return Number(payload?.code) === 502
            || Number(payload?.errcode) === 502
            || String(payload?.msg ?? payload?.errmsg ?? '').toLowerCase().includes('invalid token');
    }
    looksLikeGenericErrorPayload(payload) {
        if (!payload) {
            return false;
        }
        const code = payload.code ?? payload.errcode;
        return typeof code === 'number' && code !== 0 && code !== 200;
    }
    isInvalidTokenError(error) {
        return error instanceof Error && error.message.toLowerCase().includes('invalid token');
    }
    isAbortError(error) {
        if (!(error instanceof Error)) {
            return false;
        }
        const name = error.name.toLowerCase();
        const message = error.message.toLowerCase();
        return name === 'aborterror' || message.includes('this operation was aborted') || message.includes('operation was aborted');
    }
    isTimeoutError(error) {
        return error instanceof TTLockTimeoutError;
    }
    errorToMessage(error) {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
exports.TTLockApiClient = TTLockApiClient;
//# sourceMappingURL=api-client.js.map