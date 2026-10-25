CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"booking_id" text NOT NULL,
	"raw" jsonb NOT NULL,
	"normalised" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" text PRIMARY KEY NOT NULL,
	"carrier" text NOT NULL,
	"service" text NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"price_per_pallet" numeric NOT NULL,
	"currency" text NOT NULL,
	"transit_days" integer NOT NULL,
	"on_time_pct" numeric NOT NULL,
	"max_kg_per_pallet" numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE "confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_row_id" uuid,
	"reference" text NOT NULL,
	"booking_id" text NOT NULL,
	"status" text NOT NULL,
	"acknowledged_amber" boolean DEFAULT false NOT NULL,
	"carrier_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_row_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"row_ref" text,
	"raw" jsonb NOT NULL,
	"normalised" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"rule_id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"severity" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmations" ADD CONSTRAINT "confirmations_booking_row_id_bookings_id_fk" FOREIGN KEY ("booking_row_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_booking_row_id_bookings_id_fk" FOREIGN KEY ("booking_row_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;