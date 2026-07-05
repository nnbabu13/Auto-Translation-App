CREATE TABLE "translationapp_coachunder"."sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translationapp_coachunder"."users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "translationapp_coachunder"."session_listeners" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"listener_name" varchar NOT NULL,
	"target_language" varchar NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "translationapp_coachunder"."translation_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"original_text" text NOT NULL,
	"translated_text" text NOT NULL,
	"source_language" text NOT NULL,
	"target_language" text NOT NULL,
	"speaker" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "translationapp_coachunder"."translation_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"target_language" text NOT NULL,
	"target_languages" text[] DEFAULT '{"en"}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "translationapp_coachunder"."session_listeners" ADD CONSTRAINT "session_listeners_session_id_translation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "translationapp_coachunder"."translation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translationapp_coachunder"."translation_logs" ADD CONSTRAINT "translation_logs_session_id_translation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "translationapp_coachunder"."translation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translationapp_coachunder"."translation_sessions" ADD CONSTRAINT "translation_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "translationapp_coachunder"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "translationapp_coachunder"."sessions" USING btree ("expire");