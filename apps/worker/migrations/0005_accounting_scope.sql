-- Advertise an optional new capability for this product resource only.
-- Never edit client, consent, access-token or refresh-token scopes.
-- Unknown/custom resource policy is left unchanged and requires operator review.
UPDATE oauthResource
SET allowedScopes = json_insert(allowedScopes, '$[#]', 'mcp:write')
WHERE substr(identifier, -4) = '/mcp'
  AND json_valid(allowedScopes)
  AND json_type(allowedScopes) = 'array'
  AND json_array_length(allowedScopes) = 2
  AND (SELECT count(DISTINCT value) FROM json_each(allowedScopes)
       WHERE value IN ('mcp:read', 'offline_access')) = 2;
