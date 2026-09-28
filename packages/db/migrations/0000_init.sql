CREATE TABLE "worker_heartbeats" (
	"worker" text PRIMARY KEY NOT NULL,
	"beat_at" timestamp with time zone NOT NULL
);
