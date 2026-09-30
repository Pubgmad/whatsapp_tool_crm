import Link from "next/link";
import { getPublicPlatformConfig } from "../../lib/platform";
import { getPublishedPrivacyPolicy } from "../../lib/privacy-policy";
import PolicyText from "../../components/policy-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const policy = await getPublishedPrivacyPolicy();
  return { title: policy.document.title, description: policy.document.intro };
}

export default async function PrivacyPolicyPage() {
  const [platform, policy] = await Promise.all([getPublicPlatformConfig(), getPublishedPrivacyPolicy()]);
  const { document, effectiveDate } = policy;

  return (
    <main className="legalShell">
      <article className="legalDoc">
        <header className="legalHero">
          <p className="kicker">{platform.company_name} {platform.product_tagline}</p>
          <h1>{document.title}</h1>
          <p><PolicyText value={document.intro} supportEmail={platform.support_email} companyName={platform.company_name} /></p>
          <span>Last updated: {effectiveDate}</span>
        </header>
        {document.sections.map((section, index) => (
          <section key={index}>
            <h2>{index + 1}. {section.heading}</h2>
            {section.paragraphs.map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex}><PolicyText value={paragraph} supportEmail={platform.support_email} companyName={platform.company_name} /></p>
            ))}
            {section.bullets.length > 0 && <ul>{section.bullets.map((item, itemIndex) => (
              <li key={itemIndex}><PolicyText value={item} supportEmail={platform.support_email} companyName={platform.company_name} /></li>
            ))}</ul>}
          </section>
        ))}
        <footer className="legalFooter"><Link href="/">Back to CRM</Link></footer>
      </article>
    </main>
  );
}
