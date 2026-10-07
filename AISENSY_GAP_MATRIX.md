# WhatsApp SaaS production gap matrix

Generated 2026-10-07 from `lib/product-capability-registry.js` (do not edit this table by hand; run `npm run docs:parity`).

Registry: **50** capabilities — **50** strong, **0** partial, **0** gap.

| Capability | Group | Code | Benchmarks | Evidence | Operator note |
| --- | --- | --- | --- | --- | --- |
| Shared inbox & Cloud API messaging | Core CRM & messaging | strong | aisensy, meta | lib/actions.js, lib/meta.js |  |
| Multi-agent assignment & handoff | Core CRM & messaging | strong | aisensy | lib/support-policy.js, lib/conversation-handoff.js, components/workspace-app.js |  |
| Contacts, consent, import/export, segments | Core CRM & messaging | strong | aisensy | lib/segments.js, lib/audience-rules.js |  |
| Broadcast campaigns, schedule, approval | Campaigns, segments & retargeting | strong | aisensy, meta | lib/actions.js, lib/campaign-controls.js |  |
| Retry failed campaign recipients | Campaigns, segments & retargeting | strong | aisensy | lib/campaign-controls.js, lib/campaign-retry-policy.js, lib/campaign-failed-workbench.js |  |
| AiSensy-style retarget presets & dynamic audiences | Campaigns, segments & retargeting | strong | aisensy | lib/retargeting.js, lib/campaign-audience-sync.js, lib/retargeting-segment-refresh.js |  |
| Tracked links & button-click attribution | Campaigns, segments & retargeting | strong | aisensy | lib/click-tracking.js, lib/interactive-button-attribution.js, lib/audience-rules.js | Tracked URL tokens plus interactive/template button replies stored as interactive_button_reply events for retargeting. |
| Templates, carousel, catalog, AUTH sends | Campaigns, segments & retargeting | strong | aisensy, meta | lib/advanced-template-components.js, lib/template-send-components.js |  |
| Marketing Messages API send path | Campaigns, segments & retargeting | strong | meta | lib/actions.js | MM Lite optimizer features (TTL, creative optimization, benchmarks) are Meta-side; this app uses the send/eligibility path. |
| Rule/API automation flows | Flows & automation | strong | aisensy | lib/automation.js, lib/automation-node-runtime.js |  |
| Native WhatsApp Flows design & publish | Flows & automation | strong | aisensy, meta | lib/flow-design.js, lib/whatsapp-experiences.js, lib/whatsapp-flow-crypto.js |  |
| Flow data exchange & transactional runtime | Flows & automation | strong | meta | lib/flow-runtime.js, lib/external-availability.js |  |
| Per-screen Flow funnel & drop-off | Flows & automation | strong | aisensy | lib/flow-screen-analytics.js, lib/flow-runtime.js, app/api/whatsapp/flow-analytics/route.js | Screen events require the managed runtime data endpoint on your APP_URL. |
| Hosted transactional pages & CTA URLs | Flows & automation | strong | aisensy | lib/whatsapp-webviews.js, app/w/[viewId]/page.js | Hosted HTTPS pages; not a guaranteed in-chat webview on every client. |
| Grounded AI suggestions & knowledge | AI & bots | strong | aisensy | lib/ai-support.js, lib/ai-knowledge-import.js |  |
| Capped automatic AI replies | AI & bots | strong | aisensy | lib/ai-auto-replies.js, lib/ai-policy.js |  |
| Owner-reviewed CRM/booking/order actions | AI & bots | strong | aisensy | lib/ai-actions.js, lib/ai-booking-action.js |  |
| Platform-gated autonomous action execution | AI & bots | strong | aisensy | lib/ai-policy.js, lib/ai-actions.js | Requires platform ai_autonomous_actions_enabled or AI_AUTONOMOUS_ACTIONS_ENABLED plus owner setting. |
| Intent-based team routing on handoff | AI & bots | strong | aisensy | lib/ai-intent-routing.js |  |
| Dialogflow CX auto-reply bridge | AI & bots | strong | aisensy | lib/dialogflow-bot.js |  |
| Catalog messages & orders | Commerce & payments | strong | aisensy, meta | lib/whatsapp-commerce.js |  |
| Native WhatsApp payments | Commerce & payments | strong | aisensy, meta | lib/whatsapp-native-payments.js | Region and PSP eligibility are Meta-controlled. |
| Razorpay hosted checkout & ledger | Commerce & payments | strong | aisensy | lib/merchant-payments.js, lib/razorpay.js |  |
| Abandoned checkout recovery | Commerce & payments | strong | aisensy | lib/commerce-automation.js, lib/provider-connectors.js |  |
| CTWA campaign operations | Ads & attribution | strong | aisensy, meta | lib/whatsapp-ads.js |  |
| Ad insights & readiness reporting | Ads & attribution | strong | aisensy, meta | lib/whatsapp-ads-report.js, app/api/whatsapp/ads/report/route.js |  |
| Evidence-bounded AI ad advice | Ads & attribution | strong | aisensy | lib/whatsapp-ad-advice.js | Read-only suggestions; no automatic budget or creative changes. |
| WhatsApp conversion measurement | Ads & attribution | strong | meta | lib/whatsapp-conversions.js |  |
| Journey & referral analytics | Ads & attribution | strong | aisensy | lib/whatsapp-journey-analytics.js, lib/whatsapp-referral.js |  |
| Business App coexistence & history | Meta WhatsApp products | strong | meta | lib/coexistence.js |  |
| WhatsApp Calling (WebRTC) | Meta WhatsApp products | strong | aisensy, meta | lib/whatsapp-calling.js |  |
| Lists, buttons, interactive messages | Meta WhatsApp products | strong | meta | lib/actions.js |  |
| Signed Meta webhooks & durable queue | Meta WhatsApp products | strong | meta, platform | lib/meta-webhook-queue.js, lib/actions.js |  |
| WhatsApp Groups (Cloud API) | Meta WhatsApp products | strong | meta | lib/whatsapp-groups.js, components/whatsapp-groups.js, app/api/whatsapp/groups/route.js | Platform-gated; sync and send when Meta grants Groups API on the WABA. |
| MM API delivery optimizations & benchmarks | Meta WhatsApp products | strong | meta | lib/mm-lite-optimizer.js, lib/mm-api-readiness.js, components/mm-lite-optimizer-panel.js | Send path and optimizer feature matrix documented in CRM; TTL/benchmarks remain Meta-controlled. |
| Shopify OAuth, inventory, drafts, reconcile | External integrations | strong | aisensy, integration | lib/shopify-auth.js, lib/shopify-drafts.js |  |
| WooCommerce store events | External integrations | strong | aisensy, integration | lib/provider-connectors.js |  |
| Google Calendar availability & booking | External integrations | strong | aisensy, integration | lib/calendar-fulfillment.js, lib/external-availability.js |  |
| HubSpot contacts, objects, outbound create | External integrations | strong | aisensy, integration | lib/hubspot-contacts.js, lib/crm-objects.js, lib/crm-object-outbound.js |  |
| Salesforce contacts, leads, objects, outbound create | External integrations | strong | aisensy, integration | lib/salesforce-contacts.js, lib/crm-object-outbound.js |  |
| Tenant API keys & signed webhooks | External integrations | strong | aisensy, integration | lib/workspace-integrations.js |  |
| Integration marketplace & automation recipes | External integrations | strong | aisensy | lib/integration-marketplace.js, components/integration-marketplace.js, app/api/integrations/marketplace/route.js | Operator catalog plus Zapier/Make/n8n webhook recipes—not a third-party app store. |
| AI safety events & abuse monitoring | AI & bots | strong | aisensy | lib/ai-safety-events.js, lib/ai-policy.js, components/ai-support-settings.js |  |
| Lead form & website traffic ad objectives | Ads & attribution | strong | aisensy, meta | lib/whatsapp-ad-objectives.js, lib/meta-leadgen-ingest.js, lib/whatsapp-ads.js, components/whatsapp-ads.js |  |
| Load-test & queue SLO certification | SaaS platform & ops | strong | platform | lib/slo-certification.js, scripts/load-test-slo.mjs, app/api/super-admin/slo-certification/route.js |  |
| Multi-browser & mobile a11y E2E matrix | SaaS platform & ops | strong | platform | lib/a11y-certification.js, e2e/a11y-public.spec.js, e2e/workspace-mobile.spec.js, playwright.config.js |  |
| Super Admin, plans, feature toggles | SaaS platform & ops | strong | platform | lib/super-admin.js, lib/feature-controls.js |  |
| Public site CMS (sections, footer, social, link/image blocks) | SaaS platform & ops | strong | platform | lib/public-site.js, components/public-site-editor.js |  |
| Live production certification checks | SaaS platform & ops | strong | platform | lib/production-certification.js |  |
| Authenticated mobile workspace E2E | SaaS platform & ops | strong | platform | e2e/workspace-mobile.spec.js, playwright.config.js |  |

Live Meta entitlement and provider acceptance are merged at runtime via `GET /api/super-admin/parity` and `GET /api/workspace/parity?` (tenant-scoped).
