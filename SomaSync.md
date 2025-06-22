# SomaSync Specification Document

**Version:** 0.2  
**Date:** 2025-06-21

## 1. Purpose

Create a peer-to-peer, file-based library synchronization daemon for high-trust networks (e.g., small teams with shared clearance). It ensures high redundancy and nuclear-resilience for a set of static assets, with an intuitive CLI daemon and a web UI.

## 2. Features at a Glance

- Peer-to-peer file sync over HTTP(S)
- SHA-256 hash verification and resume support
- Supports library subscriptions and multi-source file merging
- Per-peer trust model with auto-discovery
- Quorum-based deletion & change approval (planned)
- Status endpoint for sync progress visibility
- Clean JSON-config structure
- Secure (basic user/pass today, extensible)

## 3. Directory Layout

```
somasync/
├── go
├── somasync.js
├── config.json
├── peers.json
├── users.json
├── subscriptions.json
├── libraries.json
├── files-local.json
└── static/
```

## 4. Configuration Files

### config.json

```
{
  "port": 8000,
  "username": "me@gmail.com",
  "password": "my-password",
  "defaultSyncRoot": "./libraries"
}
```

- Listening port, credentials for other peers, and default sync root.

### peers.json

```
[
  {
    "address": "127.0.0.1:8001",
    "trusted": true,
    "username": "peeruser",
    "password": "peerpass"
  }
]
```

- Contains known peer nodes.
- `trusted: true` means we will:
  - Auto-import peer’s known peers.
  - Queue their proposed new users for review.

### users.json

```
[
  { "user": "user", "pass": "pass" }
]
```

- Users authorized to access this peer.

### libraries.json

```
{
  "Lib 1": {
    "guid": "jdfhdhdbe484746",
    "mounts": [
      { "dir": "/Volumes/video", "libpath": "/video", "readonly": true },
      { "dir": "libsync-Lib1", "libpath": "/", "sync": true }
    ]
  }
}
```

- Defines shared libraries by name and GUID.
- Readonly mounts will never be written to.
- Only one sync target per library.

### subscriptions.json

```
[
  {
    "guid": "jdfhdhdbe484746",
    "localSyncDir": "./synced/Lib1"
  }
]
```

- Subscribed libraries from remote peers.
- Each subscription must have a unique local directory.

## 5. Peer-to-Peer Sync Model

- Subscriptions define what remote libraries to follow.
- Files are merged from multiple peers into the local sync mount.
- Hashes ensure data integrity.
- If no sync target is defined but files are received, one is created automatically.

## 6. Synchronization Behavior

- Files are hashed with SHA-256.
- Resumable downloads using HTTP Range headers.
- If a file fails hash check twice, it is flagged and reported to peers.

## 7. Status & Sync Progress

### GET /status

```
{
  "uptime": "3h 12m",
  "peerSync": {
    "127.0.0.1:8001": {
      "Lib 1": "94.3%",
      "Lib 2": "100%"
    }
  },
  "errors": [
    { "guid": "abc...", "file": "foo.mp4", "issue": "hash-mismatch" }
  ]
}
```

- Web UI includes a live view of sync status across peers.

## 8. Authentication & Trust

- HTTP Basic Auth or cookie login.
- Login-based web UI.
- Trusted peers can send proposed user entries for manual approval.

## 8.1 Trust Model & Peer Levels
- Each peer in peers.json includes a "trusted": true|false field.
- Trusted peers:
  - Can add files to shared libraries.
  - Participate in quorum-based delete/move decisions.
  - Share new user credentials (for review).
- Untrusted peers:
  - May sync any library they’re authorized for.
  - Cannot add, move, or delete files.
  - Ignored for file authorship or voting.
- Public Mirror Role (Level 2)
  - Untrusted peers are encouraged to:
    - Host public browsing interfaces.
    - Seed files over BitTorrent or similar.
    - Act as digital preservation relays.
  - No access to sensitive metadata or quorum privileges.
## 8.2 File Source Trust Enforcement
When syncing:
- Only trusted peers’ versions of a file are accepted.
- If conflicting versions arise, trusted peers override.
- Untrusted peer additions are ignored completely


## 9. Discovery & Merging

- Peers can share their peer list.
- Trusted peers auto-merge their peers into ours.
- Web UI allows manual merging and editing.

## 10. API Endpoints

- `GET /files?guid=...`: List file hashes in a library
- `GET /file/:guid/*`: Stream file content
- `GET /status`: Return uptime, sync %, and file issues
- `GET /libraries`: List local libraries
- `POST /login`: Login with cookie
- `GET /logout`: Clear session
- `POST /subscribe`: Add library subscription
- `GET /peers`: List known peers
- `POST /peers/merge`: Merge peer list

## 11. Example Use Flow

- User starts the daemon (`./go`)
- Defines a local shared library in `libraries.json`
- Gets added to a trusted peer's `users.json`
- Opens Web UI and subscribes to "Lib 1"
- Files begin downloading
- UI shows sync % across all known peers

## 12. Future Enhancements

- HTTPS + signature-based auth
- File encryption
- Federation model
- Deletion quorum approval
- CLI tool (`somasyncctl`)

## 13. Deliverables

- `somasync.js`: Daemon
- `web/`: Frontend
- `auth.js`: Middleware
- `sync.js`: Core engine
- `library.js`: Merge logic
- `status.js`: Status engine