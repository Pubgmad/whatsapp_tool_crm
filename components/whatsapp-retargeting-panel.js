"use client";

import { useCallback, useEffect, useState } from "react";
import { Crosshair, Loader2, Megaphone, RefreshCcw, Sparkles, Users } from "lucide-react";
import "./whatsapp-retargeting-panel.css";

export default function WhatsAppRetargetingPanel({
  api,
  postJson,
  campaign,
  canManage,
  onSegmentCreated,
  onLaunchCampaign
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingPreset, setPendingPreset] = useState("");
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    if (!campaign?.id) return;
    setLoading(true);
    setError("");
    api(`/api/campaigns/${campaign.id}/retarget`)
      .then((result) => setSnapshot(result))
      .catch((cause) => setError(cause.message || "Could not load retarget audiences"))
      .finally(() => setLoading(false));
  }, [api, campaign?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const createAudience = async (presetId) => {
    if (!canManage) return;
    setPendingPreset(presetId);
    setError("");
    try {
      const result = await postJson(`/api/campaigns/${campaign.id}/retarget`, { presetId });
      onSegmentCreated?.(result);
      load();
    } catch (cause) {
      setError(cause.message || "Could not create audience");
    } finally {
      setPendingPreset("");
    }
  };

  const refreshAudience = async () => {
    if (!canManage || !campaign.dynamicAudience) return;
    setSyncing(true);
    setError("");
    try {
      await postJson(`/api/campaigns/${campaign.id}/sync-audience`, {});
      load();
    } catch (cause) {
      setError(cause.message || "Audience refresh failed");
    } finally {
      setSyncing(false);
    }
  };

  const eligible = (snapshot?.presets || []).filter((preset) => preset.eligibleCount > 0);

  return (
    <section className="retargetPanel" aria-label="WhatsApp retargeting">
      <header className="retargetPanelHead">
        <div className="retargetPanelTitle">
          <span className="retargetIconWrap"><Crosshair size={20} /></span>
          <div>
            <strong>Retarget this broadcast</strong>
            <p>Build live audiences from delivery, reads, clicks, and replies — like AiSensy-style follow-ups.</p>
          </div>
        </div>
        <div className="retargetPanelActions">
          {campaign.dynamicAudience && canManage && (
            <button className="secondaryAction" type="button" disabled={syncing} onClick={refreshAudience}>
              {syncing ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
              Refresh audience
            </button>
          )}
          <button className="secondaryAction" type="button" onClick={load} disabled={loading}>
            <RefreshCcw size={16} /> Reload counts
          </button>
        </div>
      </header>

      {error && <p className="retargetError" role="alert">{error}</p>}
      {loading && !snapshot && (
        <div className="retargetLoading"><Loader2 className="spin" size={22} /><span>Calculating audiences…</span></div>
      )}

      {snapshot && (
        <div className="retargetPresetGrid">
          {snapshot.presets.map((preset) => {
            const active = pendingPreset === preset.id;
            const disabled = !canManage || !preset.eligibleCount || active;
            return (
              <article
                key={preset.id}
                className={`retargetPresetCard${preset.eligibleCount ? " isReady" : ""}`}
                data-preset={preset.id}
              >
                <div className="retargetPresetBadge">
                  <Sparkles size={14} />
                  {preset.eligibleCount > 0 ? `${preset.eligibleCount} contacts` : "No matches yet"}
                </div>
                <h4>{preset.title}</h4>
                <p>{preset.description}</p>
                {preset.requiresTrackedLinks && <small>Uses tracked Continue links from this campaign.</small>}
                <div className="retargetPresetFooter">
                  <button
                    className="primaryAction"
                    type="button"
                    disabled={disabled}
                    onClick={() => createAudience(preset.id)}
                  >
                    {active ? <Loader2 className="spin" size={16} /> : <Users size={16} />}
                    Save audience
                  </button>
                  {onLaunchCampaign && preset.eligibleCount > 0 && (
                    <button
                      className="secondaryAction"
                      type="button"
                      disabled={disabled}
                      onClick={() => onLaunchCampaign(preset.id)}
                    >
                      <Megaphone size={16} /> New campaign
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {snapshot && !eligible.length && !loading && (
        <p className="retargetHint">Engagement data will appear after Meta delivery webhooks update this campaign.</p>
      )}
    </section>
  );
}
