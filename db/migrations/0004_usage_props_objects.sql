-- Rows saved before the fix stored props as a jsonb string holding the JSON text: unwrap them.
update usage_events set props = (props #>> '{}')::jsonb where jsonb_typeof(props) = 'string';
