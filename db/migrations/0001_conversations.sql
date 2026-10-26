CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
