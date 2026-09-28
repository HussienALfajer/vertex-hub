# 0009 — Deploy to the existing VPS with PM2 and nginx

Status: Accepted · Date: 2026-09-28

## Context
The owner runs an Ubuntu 24.04 VPS (6 vCPU, ~11 GB RAM, ~174 GB free disk at the time of writing) with Node 24, PostgreSQL 17, nginx and PM2. Docker is not installed. Other sites on the server are isolated from each other, and the server has documented conventions.

## Decision
Follow the server's conventions:
- Dedicated system user and PM2 service for Vertex Hub; processes: `api` and `worker`.
- Code in `/srv/<domain>/`; app logs in `/var/log/<site>/`; nginx logs in `/var/log/nginx/<site>.*.log`; backups in `/var/backups/<site>/`.
- Apps listen on `127.0.0.1` only; nginx is the only public gateway and serves the SPA build and authorized file downloads.
- Dedicated PostgreSQL database and role.
- Uploaded files on local disk behind a storage interface, so moving to object storage later only changes the adapter.
- Deploys never run as root and never edit files on the server by hand; everything comes from the repository.

## Consequences
- No Docker. Chromium's system dependencies are installed on the server for PDF rendering.
- Before launch: off-server backups, a domain, and optional swap need decisions (open questions).
