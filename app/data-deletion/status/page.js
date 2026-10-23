import Link from "next/link";
import { getDeletionStatus } from "../../../lib/meta-data-controls";
import { getPublicPlatformConfig } from "../../../lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Data deletion status",
  robots: { index: false, follow: false }
};

function displayDate(value) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
}

export default async function DataDeletionStatusPage({ searchParams }) {
  const params = await searchParams;
  const platform = await getPublicPlatformConfig();
  const record = await getDeletionStatus(params?.code);
  const companyName = platform.company_name || "Platform operator";
  const supportEmail = platform.support_email || "";

  return (
    <main className="legalShell deletionStatusShell">
      <article className="legalDoc deletionStatusCard">
        <header className="legalHero">
          <p className="kicker">{companyName}</p>
          <h1>Data deletion status</h1>
          <p>Use this page to confirm the processing status of a Meta data deletion request.</p>
        </header>
        <section>
          {record ? (
            <div className="deletionStatusDetails">
              <span className={`badge ${record.status === "completed" ? "good" : "warn"}`}>{record.status}</span>
              <dl>
                <div><dt>Confirmation code</dt><dd>{record.confirmation_code}</dd></div>
                <div><dt>Requested</dt><dd>{displayDate(record.requested_at)}</dd></div>
                <div><dt>Completed</dt><dd>{displayDate(record.completed_at)}</dd></div>
              </dl>
              <p>{record.status === "completed"
                ? (record.result_code === "no_linked_data"
                  ? "No Meta-linked data was found for this confirmation code."
                  : "Meta-linked credentials and Meta-sourced records for the authorization were deleted or anonymized. Other company records follow the privacy policy.")
                : record.status === "failed"
                  ? "Deletion did not finish. It can be retried. Contact the platform operator and include only this confirmation code."
                  : "Deletion is in progress. This page does not list workspaces, Meta user ids, or deleted content."}</p>
            </div>
          ) : (
            <div className="deletionStatusDetails">
              <span className="badge warn">Not found</span>
              <p>This confirmation code is invalid or no longer available. Check the complete status URL returned when the request was submitted.</p>
            </div>
          )}
          {supportEmail && <p>For assistance, contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>}
        </section>
        <footer className="legalFooter"><Link href="/privacy-policy">View Privacy Policy</Link></footer>
      </article>
    </main>
  );
}
