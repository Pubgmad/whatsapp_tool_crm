export const TERMS_EFFECTIVE_DATE = "11 October 2026";

export const DEFAULT_TERMS_OF_SERVICE = {
  title: "Terms of Service",
  intro:
    "These Terms of Service govern access to and use of the {{company_name}} WhatsApp CRM platform, including workspaces, messaging tools, automations, ads connections, and related services. By creating an account or using the platform, you agree to these terms.",
  sections: [
    {
      heading: "Acceptance of Terms",
      paragraphs: [
        "By signing up, logging in, connecting a WhatsApp Business account, or otherwise using the platform, you confirm that you have authority to bind the business you represent and that you accept these Terms of Service and our Privacy Policy.",
        "If you do not agree, do not use the platform."
      ],
      bullets: []
    },
    {
      heading: "The Service",
      paragraphs: [
        "{{company_name}} provides software that helps businesses manage WhatsApp Business messaging, contacts, templates, campaigns, inbox conversations, automations, team access, billing, and optional advertising integrations.",
        "We may improve, add, or remove features, set usage limits, and change plan availability as the product evolves."
      ],
      bullets: []
    },
    {
      heading: "Accounts and Responsibilities",
      paragraphs: ["You are responsible for:"],
      bullets: [
        "Keeping login credentials secure and restricting access to authorized team members.",
        "Ensuring information submitted to the platform is accurate and lawfully obtained.",
        "All activity that occurs under your company workspace.",
        "Complying with applicable laws, Meta/WhatsApp policies, advertising rules, and privacy requirements.",
        "Obtaining valid customer consent before sending marketing or promotional messages."
      ]
    },
    {
      heading: "WhatsApp, Meta, and Third-Party Platforms",
      paragraphs: [
        "The platform connects to Meta services such as WhatsApp Business Platform / Cloud API and, where enabled, Facebook Login and Marketing/Ads APIs. Your use of those services is also subject to Meta’s terms, policies, and access requirements.",
        "You must use your own WhatsApp Business account, Page, ad account, and related business assets unless otherwise agreed in writing. We are not responsible for Meta outages, policy enforcement, message delivery failures, account restrictions, or review decisions by Meta."
      ],
      bullets: []
    },
    {
      heading: "Acceptable Use",
      paragraphs: ["You may not use the platform to:"],
      bullets: [
        "Send spam, unsolicited marketing, or messages without required consent.",
        "Violate WhatsApp Business Messaging Policy, Meta Platform Terms, or applicable advertising rules.",
        "Upload unlawful, harmful, deceptive, or infringing content.",
        "Attempt to bypass security, rate limits, billing controls, or access another company’s data.",
        "Reverse engineer, abuse, or disrupt the service, APIs, or infrastructure.",
        "Use the service for unlawful surveillance, fraud, or any activity prohibited by law."
      ]
    },
    {
      heading: "Customer Data",
      paragraphs: [
        "You retain ownership of the business and customer data you submit. You grant us a limited license to host, process, transmit, and display that data solely to provide and secure the service.",
        "You are the controller of customer contact and messaging data uploaded into your workspace. Our handling of personal data is described in the Privacy Policy at /privacy-policy."
      ],
      bullets: []
    },
    {
      heading: "Plans, Billing, and Suspension",
      paragraphs: [
        "Paid features, plan limits, and billing terms may apply based on the plan selected for your workspace. Fees are charged according to the plan and payment method configured for your account.",
        "We may suspend or restrict access for non-payment, policy violations, security risk, legal requirements, or misuse of Meta/WhatsApp integrations. Suspension does not relieve outstanding payment obligations where applicable."
      ],
      bullets: []
    },
    {
      heading: "Intellectual Property",
      paragraphs: [
        "The platform, including software, design, branding, documentation, and related materials, is owned by {{company_name}} or its licensors. These terms do not transfer ownership of our intellectual property to you.",
        "Feedback you provide may be used to improve the product without obligation to you."
      ],
      bullets: []
    },
    {
      heading: "Disclaimer and Limitation of Liability",
      paragraphs: [
        "The service is provided on an “as is” and “as available” basis. To the fullest extent permitted by law, we disclaim warranties of merchantability, fitness for a particular purpose, and non-infringement.",
        "To the fullest extent permitted by law, {{company_name}} is not liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, lost data, message delivery failures, Meta enforcement actions, or business interruption arising from use of the platform."
      ],
      bullets: []
    },
    {
      heading: "Termination",
      paragraphs: [
        "You may stop using the service at any time. We may terminate or suspend access if you breach these terms, create legal or security risk, or fail to meet payment or platform requirements.",
        "After termination, we may retain or delete data as described in the Privacy Policy and as required for legal, security, or operational purposes."
      ],
      bullets: []
    },
    {
      heading: "Changes to These Terms",
      paragraphs: [
        "We may update these Terms of Service from time to time. The updated version will be posted on this page with a revised last updated date. Continued use of the platform after an update means the updated terms apply."
      ],
      bullets: []
    },
    {
      heading: "Contact",
      paragraphs: [
        "For questions about these Terms of Service, contact {{support_email}}."
      ],
      bullets: []
    }
  ]
};

export function getTermsOfService() {
  return {
    document: DEFAULT_TERMS_OF_SERVICE,
    effectiveDate: TERMS_EFFECTIVE_DATE
  };
}
