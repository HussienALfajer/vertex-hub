# deploy

Everything installed on the production server comes from this folder. Runbook: `docs/deployment.md`. Decision: ADR 0009.

## Rules
- Never run commands on the server (`ssh vertex ...`) without the owner's explicit approval in the current conversation. Reading this folder and editing it locally needs no approval.
- The server is never edited by hand. A change lands here, merges to `main`, and is installed by `deploy.sh` or `provision.sh`.
- `provision.sh` must stay idempotent: running it twice changes nothing the second time.
- Apps listen on `127.0.0.1` only; nginx is the only public listener. One system user (`vertexhub`), no sudo.
- Scripts use `set -euo pipefail` and stop at the first failure (the health check uses `set -u` because it must survive failed probes). Quote every variable. Check with `bash -n <file>` before committing.
- Secrets live only in `/srv/hub.vertexmedia.pro/shared/.env` on the server, never in this folder (the repository is public).
- A deploy must be able to roll back: migrations are backward compatible (see `packages/db/CLAUDE.md`).
- nginx changes are tested with `nginx -t` on the server before reload, as part of an approved server session.
