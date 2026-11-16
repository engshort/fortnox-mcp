-- Expand only the known API resource policy. Client registrations, consents and
-- existing token families retain their scopes and require explicit reapproval.
UPDATE oauthResource
SET allowedScopes = json_insert(allowedScopes, '$[#]', 'api:bridge', '$[#]', 'api:write', '$[#]', 'api:files')
WHERE substr(identifier, -7) = '/api/v1'
  AND json_valid(allowedScopes)
  AND json_type(allowedScopes) = 'array'
  AND (SELECT count(*) FROM json_each(allowedScopes)
       WHERE value NOT IN ('api:read', 'api:finance:read', 'offline_access')) = 0
  AND (SELECT count(DISTINCT value) FROM json_each(allowedScopes)
       WHERE value IN ('api:read', 'offline_access')) = 2;
