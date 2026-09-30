import { AppError, query, toIso } from "./db.js";

export const DEFAULT_PRIVACY_POLICY = {
  title: "Privacy Policy",
  intro: "This policy explains how the platform collects, uses, stores, shares, and protects data when companies use it to manage WhatsApp Business contacts, templates, campaigns, inbox replies, automation, and subscription services.",
  sections: [
    {
      heading: "Who We Are",
      paragraphs: [
        "{{company_name}} provides a WhatsApp CRM platform that helps businesses connect their own WhatsApp Business account, manage opted-in contacts, send approved WhatsApp templates, monitor campaign delivery, automate replies, and respond to customer messages.",
        "For privacy questions or data deletion requests, contact us at {{support_email}}."
      ],
      bullets: []
    },
    {
      heading: "Data We Collect",
      paragraphs: ["Depending on how the platform is used, we may process the following data:"],
      bullets: [
        "Company account details such as business name, owner name, email address, subscription status, and account status.",
        "Login and security data such as hashed passwords, secure session identifiers, audit logs, and timestamps.",
        "WhatsApp Business connection details such as WhatsApp Business Account ID, phone number ID, business phone number, webhook configuration, and encrypted access tokens.",
        "Customer contact data uploaded by companies, including customer names, phone numbers, marketing permission status, unsubscribe status, and source information.",
        "WhatsApp campaign data such as template names, campaign names, selected recipients, delivery status, failed message details, and read/delivery events received from Meta.",
        "Inbox and message data such as incoming customer messages, outgoing replies, message timestamps, and Meta message identifiers.",
        "Billing and subscription data when paid plans are enabled, including plan, renewal status, payment status, invoices, and payment provider references."
      ]
    },
    {
      heading: "How We Use Data",
      paragraphs: ["We use data to:"],
      bullets: [
        "Create and manage company workspaces.",
        "Authenticate users and protect account access.",
        "Connect company-owned WhatsApp Business accounts to the platform.",
        "Send WhatsApp template messages and replies through the WhatsApp Business Platform.",
        "Receive customer replies and delivery/read status updates from Meta webhooks.",
        "Display campaign results, inbox conversations, unsubscribe status, automation status, and operational activity.",
        "Manage subscriptions, billing status, plan limits, and account suspension where applicable.",
        "Improve security, reliability, support, and compliance."
      ]
    },
    {
      heading: "WhatsApp and Meta Data Processing",
      paragraphs: [
        "Companies using this platform connect their own WhatsApp Business account. WhatsApp messages and related events are processed through Meta's WhatsApp Business Platform / Cloud API. When a company sends a message, our platform sends the request to Meta using the company's configured WhatsApp credentials. When a customer replies or a message status changes, Meta sends webhook events back to our platform.",
        "Companies are responsible for collecting valid customer consent before sending marketing messages and for following WhatsApp Business Messaging Policy, applicable privacy laws, and anti-spam rules."
      ],
      bullets: []
    },
    {
      heading: "How We Share Data",
      paragraphs: ["We do not sell customer contact lists or WhatsApp conversations. We may share data only as needed with:"],
      bullets: [
        "Meta / WhatsApp Business Platform to send messages, receive message events, and manage templates.",
        "Hosting, database, logging, email, storage, and infrastructure providers used to operate the platform.",
        "Payment processors when subscription billing is enabled.",
        "Legal, compliance, or security authorities when required by law or necessary to protect the platform."
      ]
    },
    {
      heading: "Data Storage and Security",
      paragraphs: [
        "We use server-side authentication, database access controls, tenant-level data separation, password hashing, secure HTTP-only cookies, and encrypted storage for sensitive WhatsApp access tokens where configured. Access to company data is limited based on user role and company workspace.",
        "No method of internet transmission or electronic storage is completely risk-free, but we take reasonable technical and organizational steps to protect data from unauthorized access, misuse, loss, or disclosure."
      ],
      bullets: []
    },
    {
      heading: "Data Retention",
      paragraphs: [
        "We retain company, customer, campaign, inbox, automation, and billing data for as long as required to provide the service, comply with legal obligations, resolve disputes, enforce agreements, prevent abuse, and maintain business records. Companies may request deletion of their workspace data, subject to legal and operational retention requirements."
      ],
      bullets: []
    },
    {
      heading: "User Choices and Deletion Requests",
      paragraphs: [
        "Companies can remove contacts, suppress contacts from future campaigns, and manage WhatsApp setup information inside the platform. Customers can unsubscribe from marketing messages by replying with opt-out language such as STOP where supported by the business workflow.",
        "To request access, correction, export, or deletion of data, email {{support_email}}. We may need to verify the requester before processing the request."
      ],
      bullets: []
    },
    {
      heading: "Children's Privacy",
      paragraphs: [
        "The platform is intended for business use and is not directed to children. Companies should not knowingly upload or process data belonging to children unless they have the legal right to do so."
      ],
      bullets: []
    },
    {
      heading: "Changes to This Policy",
      paragraphs: [
        "We may update this Privacy Policy from time to time. The updated version will be posted on this page with a revised last updated date. Continued use of the platform after updates means the updated policy applies."
      ],
      bullets: []
    }
  ]
};

function requiredText(value, name, max) {
  if (typeof value !== "string") throw new AppError(`${name} must be text.`, 400, "VALIDATION_ERROR");
  const text = value.trim();
  if (!text || text.length > max) throw new AppError(`${name} must be between 1 and ${max} characters.`, 400, "VALIDATION_ERROR");
  return text;
}

function textList(value, name, count, max) {
  if (!Array.isArray(value) || value.length > count) throw new AppError(`${name} is invalid.`, 400, "VALIDATION_ERROR");
  return value.map((item) => requiredText(item, name, max));
}

export function validatePrivacyDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError("Policy document is invalid.", 400, "VALIDATION_ERROR");
  if (!Array.isArray(value.sections) || value.sections.length < 1 || value.sections.length > 30) {
    throw new AppError("The policy must have 1 to 30 sections.", 400, "VALIDATION_ERROR");
  }
  const document = {
    title: requiredText(value.title, "Policy title", 120),
    intro: requiredText(value.intro, "Policy introduction", 5000),
    sections: value.sections.map((section) => {
      const heading = requiredText(section?.heading, "Section heading", 200);
      const paragraphs = textList(section?.paragraphs, "Paragraph", 12, 5000);
      const bullets = textList(section?.bullets, "List item", 30, 1000);
      if (!paragraphs.length && !bullets.length) throw new AppError("Every section needs content.", 400, "VALIDATION_ERROR");
      return { heading, paragraphs, bullets };
    })
  };
  if (JSON.stringify(document).length > 60000) throw new AppError("Policy document is too long.", 400, "VALIDATION_ERROR");
  return document;
}

export async function getPublishedPrivacyPolicy() {
  const result = await query("SELECT version,document,effective_date,published_at FROM privacy_policy_versions ORDER BY version DESC LIMIT 1");
  const row = result.rows[0];
  if (!row) throw new AppError("Privacy policy is not published.", 503, "POLICY_UNAVAILABLE");
  return { version: row.version, document: row.document, effectiveDate: row.effective_date, publishedAt: toIso(row.published_at) };
}
