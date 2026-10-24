# Meta App Review — final recording & submission guide

**App:** crm · **App ID:** `2166072280614956` · **Product URL:** https://crm.mathstrat-sites.com  

Use this document as your only checklist: what to prepare, which video to record, how to record it, where to upload it in Meta, and what each approval unlocks in the CRM.

**Related:** technical permission map → [META_APP_REVIEW.md](./META_APP_REVIEW.md)

**Official Meta links**

- [Screen recording guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide/screen-recordings)
- [Click-to-WhatsApp ads](https://developers.facebook.com/docs/marketing-api/ad-creative/messaging-ads/click-to-whatsapp/)
- [Embedded Signup v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4/)
- [Marketing API access tier](https://developers.facebook.com/docs/marketing-api/get-started/authorization/)

---

## 1. How to use this guide

| Phase | What you do |
|-------|-------------|
| **Prepare** | Complete [Section 2](#2-prerequisites-before-any-recording) (Meta assets + server config). |
| **Record** | Follow [Section 4](#4-video-scripts) in order: **B is required now**; A only if Meta asks again; C–E only if you add those permissions. |
| **Submit** | [Section 5](#5-where-and-how-to-submit-in-meta) — attach each video to the matching permissions, then submit. |
| **Tier only** | [Section 6](#6-marketing-api-access-tier-no-video) — API usage, then request in dashboard (no screencast). |

Record in **English**, **1080p**, full browser (URL bar visible for OAuth). Do **not** activate ads or spend budget. Create campaigns **paused** only.

---

## 2. Prerequisites (before any recording)

### 2.1 Logins (two different systems)

| System | Who | Purpose |
|--------|-----|---------|
| **CRM (your product)** | `metareview@gmail.com` | Meta reviewers test the app **without Razorpay**. See **CRM reviewer login** below. |
| **Facebook / Meta** | e.g. `balajirajlat@gmail.com` (or any user) | Must be **Admin or Developer** on app **crm**, and must control test **Page**, **ad account**, and **WABA**. Used inside **Continue with Facebook** and Embedded Signup popups. |

**CRM reviewer login** (test account; same as VPS `REVIEWER_EMAIL` / `REVIEWER_PASSWORD`):

| Field | Value |
|-------|--------|
| URL | https://crm.mathstrat-sites.com/login |
| Email | `metareview@gmail.com` |
| Password | `r_n@99balA` |

If you change the password on the server, run `npm run reviewer:init` on the VPS, then update this table.

**Do not** use `balajirajlat@gmail.com` as the CRM reviewer account — that email is already a normal CRM user; `npm run reviewer:init` cannot attach a review workspace to it. Use **metareview@gmail.com** for all CRM steps in videos.

**CRM reviewer smoke test:** https://crm.mathstrat-sites.com/login → sign in → open `/app/ads` and `/app/settings/whatsapp` → no subscription paywall.

### 2.2 Meta Business assets (you must already have)

| Asset | Why you need it | Where to check |
|-------|-----------------|----------------|
| **Meta Business Portfolio** | WhatsApp + ads assets live here | [business.facebook.com](https://business.facebook.com) |
| **WABA** + **phone number** | Embedded Signup, templates, messaging, CTWA | WhatsApp Manager / Embedded Signup |
| **Facebook Page** | CTWA creative; Page list (`pages_show_list`) | Page must be able to advertise; WhatsApp number on Page should match CRM number |
| **Ad account** (`act_…`) | Create paused CTWA (`ads_management`) | Ads Manager; user needs create access |
| **Consented test WhatsApp number** | Receive template / reply (Video A) | A phone you own; opt-in documented |
| **Approved message template** | Send in Video A (if re-recording WhatsApp) | CRM **Templates** — status **Approved** |
| **(Optional) Lead form** | Video C | Page with Instant Form + test submission |
| **(Optional) Meta dataset** | Video D | Events Manager dataset ID + token with access |

### 2.3 Server / app config (already on production — do not paste secrets in App Review)

These must be correct on the VPS (`/var/www/whatsapp-crm/.env.local`). You do **not** upload them to Meta; they must already work so recordings succeed.

| Variable / item | Role |
|-----------------|------|
| `APP_URL` | `https://crm.mathstrat-sites.com` |
| `META_APP_ID` | `2166072280614956` |
| `META_APP_SECRET` | Webhook signature, OAuth, Embedded Signup |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | Production currently serves `2332269433979889` (verify in Meta → Facebook Login for Business → Configurations that this is a **WhatsApp Embedded Signup** / ES **v4** config). Alternate documented config: `2130231251032936` (**WhatsApp Embedded Signup-2**). Do not send retired `extras.sessionInfoVersion` / `v2`/`v3` `extras.version` after 2026-10-15. |
| `META_WEBHOOK_VERIFY_TOKEN` | WhatsApp webhook verification |
| `ENCRYPTION_KEY`, `DATABASE_URL`, `AUTH_SECRET` | App runtime |
| `REVIEWER_EMAIL` / `REVIEWER_PASSWORD` | `metareview@gmail.com` / `r_n@99balA` — after change run `npm run reviewer:init` |
| **PM2** `whatsapp-crm` + `whatsapp-crm-worker` | Webhooks, campaigns, insights jobs |

**Meta console (verified 2026-10-24 — should stay as-is)**

| Setting | Value |
|---------|--------|
| Valid OAuth Redirect URI | `https://crm.mathstrat-sites.com/api/whatsapp/ads/oauth/callback` |
| JS SDK domain | `https://crm.mathstrat-sites.com/` |
| Deauthorize URL | `https://crm.mathstrat-sites.com/api/meta/deauthorize` |
| Data deletion URL | `https://crm.mathstrat-sites.com/api/meta/data-deletion` |
| App domain | `crm.mathstrat-sites.com` |
| Privacy / Terms | `https://crm.mathstrat-sites.com/privacy-policy`, `/terms` |

### 2.4 Current approval status (dashboard)

| Permission / item | Status | Video needed now? |
|-------------------|--------|-------------------|
| `whatsapp_business_management` | **Approved** (Sep 2026) | Only if Meta asks for re-demo |
| `whatsapp_business_messaging` | **Approved** (Sep 2026) | Only if Meta asks for re-demo |
| `public_profile` | **Approved** | No |
| `ads_management`, `ads_read`, `pages_show_list`, `pages_read_engagement` | **Rejected** (Oct 2026 — screencast) | **Yes → Video B** |
| `pages_manage_ads` | **Add to App Review** (not in Oct rejection list) | **Yes → same Video B** |
| `business_management` | **Rejected** | **Do not resubmit** — not used by this app |
| **Marketing API Access Tier** | **Rejected** (low API volume) | **No video** → Section 6 |
| `whatsapp_business_manage_events` | Not submitted | Video D if you add permission |
| `leads_retrieval`, `pages_manage_metadata` | Not on Marketing use case list | Video C if you add permissions |
| WhatsApp **Calling** use case | Not ready (no TURN on VPS) | Video E when ops ready |

---

## 3. Master map: video → permissions → what it unlocks

| Video | Record? | Attach in App Review to these permissions | What approval unlocks in the CRM |
|-------|---------|-------------------------------------------|----------------------------------|
| **A** | Only if Meta requests WhatsApp re-demo | `whatsapp_business_management`, `whatsapp_business_messaging` | **Already approved:** customers connect WABA via Embedded Signup, manage templates, send/receive messages (production Advanced Access for other businesses’ WABAs follows Meta’s access rules). |
| **B** | **Yes — priority** | `ads_management`, `ads_read`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads` | **CTWA Ads** in CRM: Facebook Login, pick Page + ad account + WA number, create **paused** CTWA campaigns, refresh live Meta status, **Campaign performance** insights. Without these, ads OAuth works only in dev/test mode for app roles. |
| **C** | Optional | `leads_retrieval`, `pages_manage_metadata` | **Lead-form sync** on `/app/ads`: optional OAuth checkbox, Page leadgen subscribe, ingest leads into **Audience**. |
| **D** | Optional | `whatsapp_business_manage_events` | **Conversions** (`/app/conversions`): send consented events to Meta dataset. |
| **E** | Optional | WhatsApp **Calling** product review (separate from Graph scope list) | **Calling** product in CRM: WebRTC calls from inbox (needs TURN + Meta calling on number). |
| **—** | **No video** | **Marketing API Access Tier** | Higher Marketing API rate limits / tier features per [Meta tier rules](https://developers.facebook.com/docs/marketing-api/get-started/authorization/); CRM still uses same CTWA code paths once tier is granted. |

**One screencast for ads:** Meta’s Oct 2026 feedback asked for a **single end-to-end** flow (login → grant → feature). Use **Video B** for all five ads/Page permissions above.

---

## 4. Video scripts

### Video A — WhatsApp connect, templates, send, inbox (optional re-demo)

**Unlocks (if submitted):** `whatsapp_business_management`, `whatsapp_business_messaging`  
**Status today:** already approved — record only if Meta asks.

**Before recording:** WABA connected on **metareview** workspace; one **approved** template; consented test recipient.

| Step | Login / place | Action | Must show on screen |
|------|---------------|--------|---------------------|
| A1 | CRM: `metareview@gmail.com` → `/login` | Sign in | No Razorpay wall |
| A2 | `/app/settings/whatsapp` | **Cloud API number** → Embedded Signup | Meta popup completes; CRM shows number |
| A3 | `/app/templates` | Create template → submit | Real Meta status (e.g. PENDING/APPROVED) |
| A4 | `/app/campaigns` or `/app/inbox` | Send **approved** template to test number | CRM send confirmation |
| A5 | Physical phone | Message received; reply | — |
| A6 | `/app/inbox` | Inbound reply + delivery/read | Webhook-driven status |

**Narration tips:** Name Embedded Signup, template API, and messaging webhook in one sentence each.

---

### Video B — CTWA + ads (required for current rejections)

**Unlocks:** `ads_management`, `ads_read`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`

**Before recording:**

1. CRM: **metareview** signed in.  
2. **WhatsApp** connected on that workspace (Embedded Signup).  
3. Facebook user (B2) is app admin and can access **Page**, **ad account**, and the **same WhatsApp number** as in CRM.  
4. **Uncheck** “Include lead-form retrieval” unless you also submit Video C.

| Step | Login / place | Action | Must show on screen |
|------|---------------|--------|---------------------|
| B1 | CRM `metareview` → `/app/ads` | Show **CTWA Ads** screen | **Continue with Facebook** |
| B2 | Same | State lead checkbox is **off** | Checkbox visible |
| B3 | Click **Continue with Facebook** | Log in with Facebook **admin** user if asked | Full OAuth; permission consent |
| B4 | Return to CRM | Select **ad account**, **Page**, **WhatsApp number** | Real names/IDs |
| B5 | Create campaign | **Paused** Click-to-WhatsApp campaign | Meta campaign/ad IDs + live status from CRM |
| B6 | **Campaign performance** | Pick campaign + dates → **Get report** | Real insights **or** say “no delivery yet” for new paused ad |
| B7 | (Optional) **Refresh campaigns** / data sources | Honest empty vs populated metrics | — |

**Narration (required for `pages_read_engagement`):**  
“This Page is used in the Click-to-WhatsApp ad creation flow; `pages_read_engagement` is required by Meta for CTWA and is exercised when we select this Page and create the paused campaign.”

**Do not** request or mention `business_management` in this submission.

**Suggested length:** 4–8 minutes.

---

### Video C — Lead forms (optional)

**Unlocks:** `leads_retrieval`, `pages_manage_metadata`

**Before recording:** Add both permissions to the app in Meta (**Use cases → Permissions and features → Add to App Review**). Page with lead form; optional test lead.

| Step | Login / place | Action | Must show on screen |
|------|---------------|--------|---------------------|
| C1 | `/app/ads` | Enable **Include lead-form retrieval** → **Continue with Facebook** | Lead scopes in OAuth |
| C2 | CRM | Complete assets; **Subscribe Page leadgen** if shown | Success state |
| C3 | **Load lead forms** → **Sync leads into CRM** | Lead in CRM |
| C4 | `/app/contacts` (Audience) | Contact from lead | CRM record |

**Note:** If webhook ingest happens after recording, say in submission notes that leadgen webhook URL is `https://crm.mathstrat-sites.com/api/webhooks/meta`.

---

### Video D — Conversions / events (optional)

**Unlocks:** `whatsapp_business_manage_events`

**Before recording:** Add permission in Meta; configure dataset in Events Manager; conversation with CTWA referral metadata if your flow requires it.

| Step | Login / place | Action | Must show on screen |
|------|---------------|--------|---------------------|
| D1 | Prerequisites | WABA + eligible conversation | — |
| D2 | `/app/conversions` | Configure dataset, Page, token | Meta verifies assets |
| D3 | Report event | One consented event (e.g. Lead) | `accepted` or Meta response in UI |

---

### Video E — Calling (optional, not ready on VPS)

**Unlocks:** WhatsApp Calling **use-case** approval (product capability, not the same as messaging scope).

**Before recording:** `WHATSAPP_CALL_TURN_URLS` + `WHATSAPP_CALL_TURN_SECRET` on VPS; calling enabled on number in Meta.

| Step | Action |
|------|--------|
| E1 | Show calling enabled in WhatsApp Manager |
| E2 | CRM **Calling** → start call from conversation |
| E3 | Show WhatsApp client receiving call |

Skip until TURN is configured ([PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md) P1-004).

---

## 5. Where and how to submit in Meta

### 5.1 Open the right place

1. Go to [developers.facebook.com](https://developers.facebook.com) → log in with your **Facebook** admin user.  
2. **My Apps** → **crm** (`2166072280614956`).  
3. Left menu: **Review** → **App Review** (or **App Review** under use case **Review**).

Direct link (when logged in):  
https://developers.facebook.com/apps/2166072280614956/app-review/submissions/

### 5.2 Add permissions to the submission

For each permission you need:

1. **Use cases** → **Customize** (e.g. **Create & manage ads with Marketing API**).  
2. Tab **Permissions and features**.  
3. Find the permission → **Add to App Review** (or add to current submission when prompted).

**Include in the new submission**

- `ads_management`  
- `ads_read`  
- `pages_show_list`  
- `pages_read_engagement`  
- `pages_manage_ads`  

**Exclude**

- `business_management`  

**Optional (only if you recorded C / D)**

- `leads_retrieval`, `pages_manage_metadata`  
- `whatsapp_business_manage_events`  

### 5.3 Attach screencasts

In the **App Review submission** UI, for each permission row:

1. Paste a **public or unlisted** video URL (Loom/Drive/YouTube unlisted — follow [Meta’s recording guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide/screen-recordings)).  
2. Use **the same Video B URL** for all five ads/Page permissions if Meta allows one video per permission (re-use the link).  
3. In **testing instructions**, provide:
   - CRM URL: `https://crm.mathstrat-sites.com/login`  
   - Test user: `metareview@gmail.com`  
   - Password: `r_n@99balA` (same as Section 2.1; paste into Meta’s secure test-user field when the form offers it).  
   - Steps: “Sign in → CTWA Ads → Continue with Facebook → create paused campaign → Get report.”

### 5.4 Submit

1. Confirm app **Published** (already true).  
2. Review privacy policy URL, icon, and data deletion URLs (Section 2.3).  
3. Click **Submit for review**.  
4. Watch **App Review** → **Submission feedback** for outcomes.

**Previous rejection reference:** submission **2026-10-10** — screencast not aligned; fix is Video B as above. Feedback URL pattern:  
`…/app-review/submissions/feedback/?submission_id=2182017535687097`

---

## 6. Marketing API Access Tier (no video)

**Unlocks:** Marketing API **Access Tier** upgrade (rate limits / tier eligibility per Meta — not a Graph permission string).

**Why it was rejected:** insufficient Ads API calls in the last 15 days.

**What to do**

1. On **metareview** workspace, complete Video B journey for real (paused CTWA + **Get report**) multiple times over several days if needed.  
2. Confirm calls in Meta developer tools / Ads API activity.  
3. **Use cases → Create & manage ads with Marketing API → Permissions** → **Marketing API Access Tier** → **Request again** / add to App Review when eligible.  
4. **No screencast** — qualification is usage-based ([authorization doc](https://developers.facebook.com/docs/marketing-api/get-started/authorization/)).

Submit tier **after** or **with** permission resubmission, per Meta’s current form (tier is separate from Video B).

---

## 7. Setup items that are not App Review videos

| Topic | Recording? | What you do |
|-------|------------|-------------|
| **Business Verification** | No | Meta Business Settings — required for some Advanced Access; complete if App Review prompts. |
| **Tech Provider / OBA / Groups** | Only if you submit those products | Follow Meta eligibility for each product; CRM **Groups** only if Meta grants Groups API. |
| **Coexistence** | Only if in submission | CRM: **Existing Business App number** on WhatsApp setup. |
| **Marketing Messages API** | Product onboarding, not this doc’s videos | Meta product enrollment + CRM capabilities gate. |

---

## 8. Troubleshooting

| Problem | Fix |
|---------|-----|
| OAuth redirect mismatch | Confirm URI in **Facebook Login for Business → Settings** (Section 2.3). |
| WhatsApp number dropdown empty | Run Embedded Signup on **metareview** workspace first. |
| Facebook Login fails | User must be app **Developer/Admin**; check MFA. |
| Insights empty | Normal for new **paused** campaign — state that on video. |
| Sign-in says “lengthen to 12 characters” | Browser was blocking the 10-character reviewer password. Sign-in no longer enforces signup min-length (deployed fix). Hard refresh `/login`. Temporary: DevTools → remove `minlength` on the password field → Sign in. |
| `reviewer:init` fails for personal email | Use **metareview@gmail.com** only. |
| Worker/webhook issues | Check https://crm.mathstrat-sites.com/api/health → `worker: ready`. |

---

## 9. Production checklist (2026-10-24)

| Item | Status |
|------|--------|
| Deploy SHA | `cb0e6d8` on VPS |
| Reviewer workspace | `metareview@gmail.com` / `r_n@99balA` (`reviewer:init` on VPS) |
| Meta OAuth / callbacks | Aligned with `crm.mathstrat-sites.com` |
| Empty App Review submission | **You** must add permissions + videos + submit |

---

## 10. Quick order of work (recommended)

1. Connect WABA on **metareview** workspace (Embedded Signup).  
2. Record **Video B** once; upload the same link to all five ads/Page permissions.  
3. Build Ads API usage; request **Marketing API Access Tier**.  
4. Submit App Review; do **not** include `business_management`.  
5. (Optional) Record **C** / **D** only if you added those permissions.  
6. (Later) Configure TURN → record **E** if Meta requires calling review.
