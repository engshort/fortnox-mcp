-- Advertise a classified optional read scope on known MCP resource policies.
-- Existing clients, consent, access and refresh tokens retain their scopes.
UPDATE oauthResource
SET allowedScopes = json_insert(allowedScopes, '$[#]', 'mcp:finance:read')
WHERE substr(identifier, -4) = '/mcp'
  AND json_valid(allowedScopes)
  AND json_type(allowedScopes) = 'array'
  AND (SELECT count(*) FROM json_each(allowedScopes)
       WHERE value NOT IN ('mcp:read', 'mcp:write', 'mcp:files', 'offline_access')) = 0
  AND (SELECT count(DISTINCT value) FROM json_each(allowedScopes)
       WHERE value IN ('mcp:read', 'offline_access')) = 2;
