# 0034 — Backups stay on the server until an off-server storage is subscribed

Status: Accepted · Date: 2026-10-19

## Context
`vertexhub-backup` writes a daily backup of the database, the environment, the nginx site, the deployed revision and the uploaded files to `/var/backups/hub.vertexmedia.pro/` on the production server (`docs/deployment.md`). Open question Q4 asked for an off-server destination, which the pre-deploy audit (SEC-01) and the launch checklist treated as required before launch. On 2026-10-19 the owner decided to launch with backups on the server only, and to add off-server copies when they subscribe to a storage service.

## Decision
- Daily backups stay on the production server, as they run today. Launch does not wait for an off-server copy.
- When the owner subscribes to a storage service, they tell Claude, and the off-server copy is added to `vertexhub-backup` with a tested restore, in its own change.

## Consequences
- A loss of the server or its disk loses the backups with it: the database, the client files, invoices and contracts. This risk is accepted by the owner until the storage service exists.
- Q4 and SEC-01 are closed by this decision; the launch checklist item "Off-server backups" moves to a follow-up that waits on the owner.
