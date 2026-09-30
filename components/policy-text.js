export default function PolicyText({ value, supportEmail, companyName }) {
  const parts = String(value || "").split(/(\{\{support_email\}\}|\{\{company_name\}\})/);
  return parts.map((part, index) => (
    <span key={index}>
      {part === "{{support_email}}" ? (supportEmail ? <a href={`mailto:${supportEmail}`}>{supportEmail}</a> : "the platform support address") : part === "{{company_name}}" ? companyName : part}
    </span>
  ));
}
