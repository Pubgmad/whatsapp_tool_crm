# Continue with Google — setup

Workspace login/signup uses a **separate** Google OAuth client from Calendar availability (`GOOGLE_CLIENT_ID`).

## Environment

```bash
GOOGLE_LOGIN_CLIENT_ID=
GOOGLE_LOGIN_CLIENT_SECRET=
APP_URL=https://your-domain.example
AUTH_SECRET=...
ENCRYPTION_KEY=...
```

## Google Cloud Console

1. Create (or select) a project → APIs & Services → Credentials → **OAuth 2.0 Client ID** (Web application).
2. Authorized JavaScript origins: `https://your-domain.example`
3. Authorized redirect URIs: `https://your-domain.example/api/auth/google/callback`
4. OAuth consent screen: add scopes `openid`, `email`, `profile`.
5. Copy Client ID / Secret into the env vars above.
6. Run `npm run db:init` so `oauth_login_states`, `oauth_identities`, and `oauth_mfa_pending` exist.

## Behaviour

- Login and signup show **Continue with Google** when both login client env vars and `APP_URL` are set (`google_login_enabled` on public platform config).
- Email/password auth is unchanged.
- Verified Google emails link to an existing user with the same email (no duplicate accounts).
- New Google signups create a normal Owner workspace — never Super Admin.
- MFA-enabled accounts complete TOTP/recovery on `/login?mfa_required=1` after Google returns.

## Local development

Use an HTTPS tunnel or a Google client that allows `http://localhost:3000/api/auth/google/callback` if your Google project permits localhost redirects.
