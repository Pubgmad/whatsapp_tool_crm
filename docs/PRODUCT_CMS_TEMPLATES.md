# Product & integration page templates (Super Admin)

## Where to edit

Super Admin → **Content** → `CmsSiteEditor`

Tabs:

- **Pages** — home, feature, product, integrations, about, contact (hero + sections)
- **Products** — catalog cards for `/products` and the header mega menu
- **Navigation** — sync Products mega menu from the catalog
- **Theme / Branding** — colors, fonts, logo, hero image

Publish after saving a draft. `reset_defaults` reloads polished built-in templates without deleting brand images.

## Public URLs

| Surface | URL |
|---------|-----|
| Product discovery grid | `/products` |
| Product slug (CMS product/feature page or catalog redirect) | `/products/[slug]` |
| Feature detail templates | `/features/[slug]` |
| Integrations showcase | `/integrations` (CMS page) |

## Editable fields (products catalog)

- Title, slug, summary, href, icon, visibility, order
- Nested features (title, summary, href, icon)
- Optional: hero heading/subheading, benefits, use cases, CTA label/href, SEO title/description

## Feature page template sections

Defaults include Overview, Workflow steps, Use cases, and a CTA band. Edit blocks in the Pages tab — no code changes required for copy updates.
