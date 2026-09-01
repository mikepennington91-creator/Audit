"""Allow only this repository's main-branch deadline workflow to run jobs.

Claims: https://docs.github.com/actions/reference/openid-connect-reference
"""
import jwt

ISSUER = 'https://token.actions.githubusercontent.com'
AUDIENCE = 'infinit-audit-jobs'
WORKFLOW = 'mikepennington91-creator/Audit/.github/workflows/audit-deadlines.yml@refs/heads/main'
_jwks = jwt.PyJWKClient(ISSUER + '/.well-known/jwks', timeout=10)


def verify_job_token(token: str):
    key = _jwks.get_signing_key_from_jwt(token)
    claims = jwt.decode(token, key.key, algorithms=['RS256'], audience=AUDIENCE,
                        issuer=ISSUER, options={'require': ['exp', 'iat', 'nbf', 'sub']})
    if (claims.get('repository_id') != '1133086327'
            or claims.get('workflow_ref') != WORKFLOW
            or claims.get('ref') != 'refs/heads/main'
            or claims.get('event_name') not in {'schedule', 'workflow_dispatch'}):
        raise jwt.InvalidTokenError('Untrusted job identity')
    return claims
