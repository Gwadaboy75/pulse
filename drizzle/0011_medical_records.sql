CREATE TABLE "appointments" (
	"user_id" integer NOT NULL,
	"id" serial NOT NULL,
	"practitioner_id" integer,
	"title" text NOT NULL,
	"starts_at" bigint NOT NULL,
	"ends_at" bigint,
	"location" text,
	"notes" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"document_id" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "appointments_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"user_id" integer NOT NULL,
	"id" serial NOT NULL,
	"document_id" text,
	"day" date NOT NULL,
	"analyte" text NOT NULL,
	"label" text NOT NULL,
	"value" double precision,
	"value_text" text,
	"unit" text,
	"ref_low" double precision,
	"ref_high" double precision,
	"ref_text" text,
	"flag" text,
	"lab_name" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "lab_results_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "medical_documents" (
	"user_id" integer NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"file_path" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"day" date,
	"practitioner_id" integer,
	"extraction" jsonb,
	"extracted_text" text,
	"status" text NOT NULL,
	"error" text,
	"notes" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "medical_documents_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "medication_events" (
	"user_id" integer NOT NULL,
	"id" serial NOT NULL,
	"medication_id" integer NOT NULL,
	"ts" bigint NOT NULL,
	"day" date NOT NULL,
	"status" text NOT NULL,
	"note" text,
	CONSTRAINT "medication_events_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"user_id" integer NOT NULL,
	"id" serial NOT NULL,
	"name" text NOT NULL,
	"dose" text,
	"form" text,
	"route" text,
	"schedule" jsonb,
	"started_on" date,
	"ended_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"reason" text,
	"practitioner_id" integer,
	"document_id" text,
	"notes" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "medications_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "practitioners" (
	"user_id" integer NOT NULL,
	"id" serial NOT NULL,
	"name" text NOT NULL,
	"specialty" text,
	"phone" text,
	"address" text,
	"notes" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "practitioners_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_documents" ADD CONSTRAINT "medical_documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_events" ADD CONSTRAINT "medication_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_events" ADD CONSTRAINT "medication_events_user_id_medication_id_medications_user_id_id_fk" FOREIGN KEY ("user_id","medication_id") REFERENCES "public"."medications"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_starts" ON "appointments" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "lab_results_analyte" ON "lab_results" USING btree ("user_id","analyte","day");--> statement-breakpoint
CREATE INDEX "lab_results_document" ON "lab_results" USING btree ("user_id","document_id");--> statement-breakpoint
CREATE INDEX "medical_documents_day" ON "medical_documents" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "medication_events_day" ON "medication_events" USING btree ("user_id","day");