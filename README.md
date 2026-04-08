# homebridge-ttlock-ttl

Homebridge plugin for **TTLock/TTL on-premise smart locks**.

This plugin signs in to the TTLock on-premise API, automatically discovers the locks available on the configured account, and exposes each visible lock to HomeKit as a **LockMechanism** accessory with an attached **Battery** service.

## Highlights

- Dynamic platform plugin with Homebridge Settings UI support
- Automatic login and token renewal for the TTLock on-premise API
- Automatic lock discovery from the configured account
- One HomeKit **LockMechanism** service per visible lock
- One HomeKit **Battery** service per visible lock
- Single **sequential polling cycle** to reduce overlapping API requests
- Adjustable retry count, timeout, retry delay, and post-action refresh delay
- Hide selected locks from HomeKit by lock ID or lock name
- Designed to follow current Homebridge Verified plugin expectations

## How it works

Each polling cycle runs in this order:

1. Validate or renew the TTLock session
2. Retrieve locks from `lock/listByUser`
3. Query the state of each visible lock
4. Query the battery level of each visible lock

The plugin serializes API calls to avoid stacking requests on top of each other. When HomeKit triggers an `onGet` or `onSet`, the background poller is paused, the read or action is performed, and polling resumes afterward.

## Requirements

- Homebridge `>= 1.8.0  || ^2.0.0`
- Node.js `20.x`, `22.x`, or `24.x`
- A TTLock on-premise account reachable at `http://onpremise.ttlock.com`
- The TTLock password entered as MD5, or plaintext that the plugin can hash automatically

## Installation

```bash
npm install -g homebridge-ttlock-ttl
```

Then open the Homebridge UI and configure the plugin from the Settings page.

## Settings

The plugin exposes the following settings in the Homebridge UI:

- **USERNAME**
- **PASSWORD as md5**
- **Polling interval (s)**
- **Low battery threshold (%)**
- **Maximum API retries**
- **Request timeout (ms)**
- **Delay between retries (ms)**
- **Refresh delay after lock/unlock (ms)**
- **HideLock**

### HideLock format

`HideLock` accepts lock IDs and/or lock names.

Examples:

```text
4717, Front Door
```

or:

```text
4717
Front Door
Back Door
```

## Example `config.json`

```json
{
  "platforms": [
    {
      "platform": "TTLockTTL",
      "username": "your-account@example.com",
      "password": "5f4dcc3b5aa765d61d8327deb882cf99",
      "pollerSeconds": 20,
      "lowBatteryThreshold": 20,
      "maxApiRetries": 3,
      "requestTimeoutMs": 10000,
      "retryDelayMs": 1000,
      "refreshDelayAfterActionMs": 3000,
      "hideLocks": "4717, Back Door"
    }
  ]
}
```

## API endpoints used

### Login

`POST /user/login`

Form body:

- `account=USERNAME`
- `password=PASSWORD_MD5`

Used to obtain and renew the session token.

### Lock discovery

`GET /lock/listByUser`

Used to discover locks on the configured account and obtain identifiers such as `lockId` and `keyId`.

### Lock state

`GET /lock/queryState?lockId=...`

Used for live lock-state refresh during polling and HomeKit reads.

### Battery level

`GET /lock/getElectricQuantity?lockId=...&byGateway=0`

Used to refresh battery percentage.

### Lock / unlock control

`POST /key/control`

- unlock uses `type=1`
- lock uses `type=2`

After a command, the plugin waits for the configured refresh delay and then re-reads the lock state.

## Notes and limitations

- Some TTLock on-premise environments do not return a live state for every lock through `queryState`. In that case, the plugin keeps the last known HomeKit state instead of throwing unhandled errors.
- If the TTLock server returns a message such as **"The remote control lock is closed. Please open it first"**, the command is being refused by the TTLock server for that lock or account.
- The plugin only exposes **visible locks** after applying the `HideLock` filter.

## Verification readiness

This project is structured as a **dynamic platform**, includes **Homebridge Settings UI** support through `config.schema.json`, does not use post-install scripts, does not include analytics, and targets current Homebridge-supported LTS Node.js versions.

Before requesting Homebridge verification, make sure all of the following are true:

- the package is published on npm
- the GitHub repository is public
- GitHub Issues are enabled
- at least one GitHub release exists with release notes
- the plugin installs cleanly on a real Homebridge instance
- no unhandled exceptions remain in normal use

## Development

```bash
npm install
```

## License

MIT
