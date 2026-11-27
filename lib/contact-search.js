/**
 * SQL predicate for Contacts list/search.
 * `contacts.tags` is JSONB (array of strings), not PostgreSQL text[].
 * Using unnest(tags) fails with: function unnest(jsonb) does not exist.
 */
export function contactSearchPredicate(paramRef) {
  return `(
    name ILIKE ${paramRef}
    OR phone ILIKE ${paramRef}
    OR COALESCE(opt_in_source, '') ILIKE ${paramRef}
    OR EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(COALESCE(tags, '[]'::jsonb)) = 'array' THEN COALESCE(tags, '[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) AS tag
       WHERE tag ILIKE ${paramRef}
    )
  )`;
}
