CREATE TABLE "hc_records" (
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"uuid" text NOT NULL,
	"start_ts" bigint NOT NULL,
	"end_ts" bigint NOT NULL,
	"day" date NOT NULL,
	"source_pkg" text,
	"seen_seq" bigint NOT NULL,
	"deleted_seq" bigint,
	CONSTRAINT "hc_records_user_id_type_uuid_pk" PRIMARY KEY("user_id","type","uuid")
);
--> statement-breakpoint
CREATE TABLE "hc_vitals" (
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"ts" bigint NOT NULL,
	"value" double precision NOT NULL,
	"record_uuid" text NOT NULL,
	CONSTRAINT "hc_vitals_user_id_kind_ts_pk" PRIMARY KEY("user_id","kind","ts")
);
--> statement-breakpoint
CREATE TABLE "ingest_endpoints" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"role" text DEFAULT 'auto' NOT NULL,
	"created_at" bigint NOT NULL,
	"last_received_at" bigint,
	"last_sequence" bigint,
	"app_version" text,
	"last_error" text,
	CONSTRAINT "ingest_endpoints_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "ingest_payloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"sequence" bigint,
	"body_hash" text NOT NULL,
	"kind" text NOT NULL,
	"gz_body" "bytea",
	"received_at" bigint NOT NULL,
	"applied_at" bigint,
	"error" text,
	"window_start" bigint,
	"window_end" bigint,
	"window_complete" boolean,
	CONSTRAINT "ingest_payloads_dedupe" UNIQUE("user_id","body_hash")
);
--> statement-breakpoint
ALTER TABLE "hc_records" ADD CONSTRAINT "hc_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hc_vitals" ADD CONSTRAINT "hc_vitals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_endpoints" ADD CONSTRAINT "ingest_endpoints_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_payloads" ADD CONSTRAINT "ingest_payloads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hc_records_span" ON "hc_records" USING btree ("user_id","type","start_ts");--> statement-breakpoint
CREATE INDEX "hc_vitals_record" ON "hc_vitals" USING btree ("user_id","record_uuid");--> statement-breakpoint
CREATE INDEX "ingest_payloads_pending" ON "ingest_payloads" USING btree ("user_id","applied_at");