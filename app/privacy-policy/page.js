import Link from "next/link";
import { getPublicPlatformConfig } from "../../lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for the WhatsApp CRM platform, including WhatsApp Business Platform data handling, customer data, retention, and deletion requests."
};

export default async function PrivacyPolicyPage() {
  const platform = await getPublicPlatformConfig();
  const productName = platform.product_tagline || "WhatsApp Business CRM";
  const companyName = platform.company_name || "Mathstrat";
  const supportEmail = platform.support_email || "mathstratofficial@gmail.com";
  const lastUpdated = platform.privacy_last_updated || "6 September 2026";

  return (
    <main className="legalShell">
      <article className="legalDoc">
        <header className="legalHero">
          <p className="kicker">{companyName} {productName}</p>
          <h1>Privacy Policy</h1>
          <p>{platform.privacy_intro}</p>
          <span>Last updated: {lastUpdated}</span>
        </header>

        <section>
          <h2>1. Who We Are</h2>
          <p>
            {companyName} provides a WhatsApp CRM platform that helps businesses connect their own WhatsApp Business account, manage opted-in contacts, send approved WhatsApp templates, monitor campaign delivery, automate replies, and respond to customer messages.
          </p>
          <p>
            For privacy questions or data deletion requests, contact us at <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
          </p>
        </section>

        <section>
          <h2>2. Data We Collect</h2>
          <p>Depending on how the platform is used, we may process the following data:</p>
          <ul>
            <li>Company account details such as business name, owner name, email address, subscription status, and account status.</li>
            <li>Login and security data such as hashed passwords, secure session identifiers, audit logs, and timestamps.</li>
            <li>WhatsApp Business connection details such as WhatsApp Business Account ID, phone number ID, business phone number, webhook configuration, and encrypted access tokens.</li>
            <li>Customer contact data uploaded by companies, including customer names, phone numbers, marketing permission status, unsubscribe status, and source information.</li>
            <li>WhatsApp campaign data such as template names, campaign names, selected recipients, delivery status, failed message details, and read/delivery events received from Meta.</li>
            <li>Inbox and message data such as incoming customer messages, outgoing replies, message timestamps, and Meta message identifiers.</li>
            <li>Billing and subscription data when paid plans are enabled, including plan, renewal status, payment status, invoices, and payment provider references.</li>
          </ul>
        </section>

        <section>
          <h2>3. How We Use Data</h2>
          <p>We use data to:</p>
          <ul>
            <li>Create and manage company workspaces.</li>
            <li>Authenticate users and protect account access.</li>
            <li>Connect company-owned WhatsApp Business accounts to the platform.</li>
            <li>Send WhatsApp template messages and replies through the WhatsApp Business Platform.</li>
            <li>Receive customer replies and delivery/read status updates from Meta webhooks.</li>
            <li>Display campaign results, inbox conversations, unsubscribe status, automation status, and operational activity.</li>
            <li>Manage subscriptions, billing status, plan limits, and account suspension where applicable.</li>
            <li>Improve security, reliability, support, and compliance.</li>
          </ul>
        </section>

        <section>
          <h2>4. WhatsApp and Meta Data Processing</h2>
          <p>
            Companies using this platform connect their own WhatsApp Business account. WhatsApp messages and related events are processed through Meta's WhatsApp Business Platform / Cloud API. When a company sends a message, our platform sends the request to Meta using the company's configured WhatsApp credentials. When a customer replies or a message status changes, Meta sends webhook events back to our platform.
          </p>
          <p>
            Companies are responsible for collecting valid customer consent before sending marketing messages and for following WhatsApp Business Messaging Policy, applicable privacy laws, and anti-spam rules.
          </p>
        </section>

        <section>
          <h2>5. How We Share Data</h2>
          <p>We do not sell customer contact lists or WhatsApp conversations. We may share data only as needed with:</p>
          <ul>
            <li>Meta / WhatsApp Business Platform to send messages, receive message events, and manage templates.</li>
            <li>Hosting, database, logging, email, storage, and infrastructure providers used to operate the platform.</li>
            <li>Payment processors when subscription billing is enabled.</li>
            <li>Legal, compliance, or security authorities when required by law or necessary to protect the platform.</li>
          </ul>
        </section>

        <section>
          <h2>6. Data Storage and Security</h2>
          <p>
            We use server-side authentication, database access controls, tenant-level data separation, password hashing, secure HTTP-only cookies, and encrypted storage for sensitive WhatsApp access tokens where configured. Access to company data is limited based on user role and company workspace.
          </p>
          <p>
            No method of internet transmission or electronic storage is completely risk-free, but we take reasonable technical and organizational steps to protect data from unauthorized access, misuse, loss, or disclosure.
          </p>
        </section>

        <section>
          <h2>7. Data Retention</h2>
          <p>
            We retain company, customer, campaign, inbox, automation, and billing data for as long as required to provide the service, comply with legal obligations, resolve disputes, enforce agreements, prevent abuse, and maintain business records. Companies may request deletion of their workspace data, subject to legal and operational retention requirements.
          </p>
        </section>

        <section>
          <h2>8. User Choices and Deletion Requests</h2>
          <p>
            Companies can remove contacts, suppress contacts from future campaigns, and manage WhatsApp setup information inside the platform. Customers can unsubscribe from marketing messages by replying with opt-out language such as STOP where supported by the business workflow.
          </p>
          <p>
            To request access, correction, export, or deletion of data, email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>. We may need to verify the requester before processing the request.
          </p>
        </section>

        <section>
          <h2>9. Children's Privacy</h2>
          <p>
            The platform is intended for business use and is not directed to children. Companies should not knowingly upload or process data belonging to children unless they have the legal right to do so.
          </p>
        </section>

        <section>
          <h2>10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. The updated version will be posted on this page with a revised last updated date. Continued use of the platform after updates means the updated policy applies.
          </p>
        </section>

        <footer className="legalFooter">
          <Link href="/">Back to CRM</Link>
        </footer>
      </article>
    </main>
  );
}