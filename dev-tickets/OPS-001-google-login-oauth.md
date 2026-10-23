# OPS-001 — Google sign-in OAuth client

**Status:** Open  
**Priority:** Ops  
**Type:** Configuration  

## Context

Workspace Google login uses separate OAuth client from Calendar (`GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`). Redirect: `${APP_URL}/api/auth/google/callback`.

`docs/WEBSITE_PRODUCT_UX_TRANSFORMATION_REPORT.md` §12: button hidden or non-functional until Google Cloud Console client is configured for production domain.

## Tasks

1. Create OAuth 2.0 Web client in Google Cloud
2. Add authorized redirect URI for `https://crm.mathstrat-sites.com/api/auth/google/callback`
3. Set env on VPS; restart web app
4. Test signup and signin with Google on production

## Acceptance criteria

- [ ] Google button visible on `/login` and `/signup` when env set
- [ ] Successful Google sign-in provisions Free Forever workspace per product rules
- [ ] Local dev optional separate client for `http://localhost:3000`

## References

- `docs/GOOGLE_LOGIN_SETUP.md`
- `.env.example` GOOGLE_LOGIN_*
