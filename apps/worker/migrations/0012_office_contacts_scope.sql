-- Extend only known API resource ceilings, never registrations, grants or tokens.
UPDATE oauthResource
SET allowedScopes = json_insert(allowedScopes, '$[#]', 'api:office:contacts:read')
WHERE substr(identifier, -7) = '/api/v1'
  AND json_valid(allowedScopes)
  AND json_type(allowedScopes) = 'array'
  AND (SELECT count(*) FROM json_each(allowedScopes)
       WHERE value NOT IN ('api:read', 'api:finance:read', 'api:bridge', 'api:write', 'api:files', 'offline_access')) = 0
  AND (SELECT count(DISTINCT value) FROM json_each(allowedScopes)
       WHERE value IN ('api:read', 'offline_access')) = 2;
