-- Read-only API resources may have been created after migration 0009 ran.
-- Align only that known resource ceiling for later UI bridge activation.
-- Registrations, consents, tokens and nonstandard resource policies are intact.
UPDATE oauthResource
SET allowedScopes = json_insert(allowedScopes, '$[#]', 'api:bridge', '$[#]', 'api:write', '$[#]', 'api:files')
WHERE substr(identifier, -7) = '/api/v1'
  AND json_valid(allowedScopes)
  AND json_type(allowedScopes) = 'array'
  AND (SELECT count(*) FROM json_each(allowedScopes)
       WHERE value NOT IN ('api:read', 'api:finance:read', 'offline_access')) = 0
  AND (SELECT count(DISTINCT value) FROM json_each(allowedScopes)
       WHERE value IN ('api:read', 'offline_access')) = 2;
