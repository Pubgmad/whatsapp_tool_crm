"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Eye, EyeOff, ShieldCheck, UserPlus } from "lucide-react";

export default function AcceptInvitePage() {
  const { token } = useParams();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError(""); setPending(true);
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(`/api/team/accept/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Invitation could not be accepted.");
      window.location.assign("/");
    } catch (nextError) { setError(nextError.message); setPending(false); }
  };
  return <main className="authShell"><section className="authPanel authPanelPro"><div className="authHeader"><p className="kicker">Company invitation</p><h1>Join the workspace</h1><p>Create your account or use the password for an existing account with this email.</p></div><form className="formGrid authForm" onSubmit={submit}><label>Name<input name="name" autoComplete="name" required /></label><label>Password<span className="passwordWrap"><input name="password" type={visible ? "text" : "password"} minLength="8" autoComplete="new-password" required /><button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>{error && <div className="formError" role="alert">{error}</div>}<button className="primaryAction authSubmit" disabled={pending}>{pending ? <ShieldCheck size={18} /> : <UserPlus size={18} />}{pending ? "Joining" : "Join workspace"}</button></form></section></main>;
}