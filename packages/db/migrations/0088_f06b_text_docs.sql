-- F06B edge case 22: old comments and briefs become rich-text documents, one paragraph per line,
-- with `@{userId}` tokens of comments as mention nodes (`richTextFromPlain` in contracts builds
-- the same documents). The plain-text columns stay as they are.
CREATE FUNCTION f06b_text_doc(body text, mentions boolean) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  line text;
  inline jsonb;
  found text[];
  token text;
  at integer;
  blocks jsonb := '[]'::jsonb;
BEGIN
  FOREACH line IN ARRAY string_to_array(body, E'\n') LOOP
    inline := '[]'::jsonb;
    WHILE mentions LOOP
      found := regexp_match(line, '@\{([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}');
      EXIT WHEN found IS NULL;
      token := '@{' || found[1] || '}';
      at := strpos(line, token);
      IF at > 1 THEN
        inline := inline || jsonb_build_array(jsonb_build_object('type', 'text', 'text', left(line, at - 1)));
      END IF;
      inline := inline || jsonb_build_array(
        jsonb_build_object('type', 'mention', 'attrs', jsonb_build_object('userId', lower(found[1])))
      );
      line := substr(line, at + length(token));
    END LOOP;
    IF line <> '' THEN
      inline := inline || jsonb_build_array(jsonb_build_object('type', 'text', 'text', line));
    END IF;
    blocks := blocks || jsonb_build_array(
      CASE WHEN jsonb_array_length(inline) = 0 THEN '{"type": "paragraph"}'::jsonb
        ELSE jsonb_build_object('type', 'paragraph', 'content', inline) END
    );
  END LOOP;
  RETURN jsonb_build_object('type', 'doc', 'content', blocks);
END;
$$;--> statement-breakpoint
UPDATE "task_comments" SET "body_doc" = f06b_text_doc("body", true) WHERE "body_doc" IS NULL;--> statement-breakpoint
UPDATE "tasks" SET "brief_doc" = f06b_text_doc("brief", false) WHERE "brief" IS NOT NULL AND "brief_doc" IS NULL;--> statement-breakpoint
DROP FUNCTION f06b_text_doc(text, boolean);
