CREATE TABLE "activity_feedback" (
	"user_id" integer NOT NULL,
	"exercise_id" text NOT NULL,
	"rpe" double precision,
	"note" text,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "activity_feedback_user_id_exercise_id_pk" PRIMARY KEY("user_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "calc_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"strain_method" text DEFAULT 'edwards' NOT NULL,
	"rmr_equation" text DEFAULT 'mifflin1990' NOT NULL,
	"activity_level" text DEFAULT 'low_active' NOT NULL,
	"phenoage_variant" text DEFAULT 'original' NOT NULL,
	"hrv_reference_method" text DEFAULT 'ewma' NOT NULL,
	"hrv_reference_days" integer DEFAULT 60 NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_feedback" ADD CONSTRAINT "activity_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calc_settings" ADD CONSTRAINT "calc_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;