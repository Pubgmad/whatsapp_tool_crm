'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, Link2, Play, Plus, RefreshCcw, Sheet, Sparkles, Workflow } from 'lucide-react';
import './whatsapp-modules.css';

export default function SmbBotsWorkspace({ api, postJson, role, featureFlags, setActiveView }) {
  const canEdit = role === 'Owner' || role === 'Manager';
  const [tab, setTab] = useState('quick');
  const [reply, setReply] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [selectedBot, setSelectedBot] = useState('');
  const [rules, setRules] = useState([]);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [ruleForm, setRuleForm] = useState({ ruleId: '', pattern: '', replyText: '', matchType: 'contains', synonymsText: '' });
  const [sheetForm, setSheetForm] = useState({
    name: 'FAQ bot',
    schemaId: 'faq',
    spreadsheetId: '',
    spreadsheetTitle: '',
    sheetName: '',
    fallbackText: '',
    matchMode: 'keyword',
    syncMode: 'poll',
    columnMap: { question: 'Question', answer: 'Answer', keywords: 'Keywords', enabled: 'Enabled' }
  });
  const [files, setFiles] = useState([]);
  const [sheetNames, setSheetNames] = useState([]);

  const load = useCallback(async () => {
    setError('');
    try {
      const [replyData, sheetsData] = await Promise.all([
        featureFlags?.reply_bots ? api('/api/bots/reply') : Promise.resolve({ bots: [] }),
        featureFlags?.sheets_bot ? api('/api/bots/sheets') : Promise.resolve({ bots: [], connection: null, schemas: [] })
      ]);
      setReply(replyData);
      setSheets(sheetsData);
      const fallback = replyData.defaultFallback || sheetsData.defaultFallback || '';
      const matchModes = sheetsData.syncPolicy?.matchModes || [];
      setSheetForm((current) => ({
        ...current,
        fallbackText: current.fallbackText || fallback,
        matchMode: matchModes.includes(current.matchMode) ? current.matchMode : (matchModes[0] || current.matchMode)
      }));
      if (!selectedBot && replyData.bots?.[0]?.id) setSelectedBot(replyData.bots[0].id);
    } catch (cause) {
      setError(cause.message);
    }
  }, [api, featureFlags?.reply_bots, featureFlags?.sheets_bot, selectedBot]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedBot || !featureFlags?.reply_bots) return;
    let active = true;
    postJson('/api/bots/reply', { action: 'listRules', botId: selectedBot })
      .then((result) => { if (active) setRules(result.rules || []); })
      .catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [selectedBot, featureFlags?.reply_bots, postJson]);

  const run = async (fn, success) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      if (success) setNotice(success);
      await load();
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screenGrid">
      <section className="actionBand">
        <div>
          <strong>WhatsApp bots</strong>
          <span>Create a quick reply bot, connect Google Sheets, or open AI Agents and Automation.</span>
        </div>
      </section>
      {error && <p className="formError" role="alert">{error}</p>}
      {notice && <p className="formSuccess" role="status">{notice}</p>}

      <div className="wa-module-controls wa-module-tabs">
        <button type="button" className={tab === 'quick' ? 'primaryAction' : 'secondaryAction'} onClick={() => setTab('quick')}><Bot size={16} /> Quick reply bot</button>
        <button type="button" className={tab === 'sheets' ? 'primaryAction' : 'secondaryAction'} onClick={() => setTab('sheets')} disabled={!featureFlags?.sheets_bot}><Sheet size={16} /> Google Sheets bot</button>
        <button type="button" className="secondaryAction" onClick={() => setActiveView?.('ai_agents')}><Sparkles size={16} /> AI Agent</button>
        <button type="button" className="secondaryAction" onClick={() => setActiveView?.('automation')}><Workflow size={16} /> Advanced automation</button>
      </div>

      {tab === 'quick' && featureFlags?.reply_bots && (
        <section className="wa-module">
          <header className="wa-module-heading">
            <h2>Quick reply bots</h2>
            {canEdit && (
              <button type="button" disabled={busy} onClick={() => run(async () => {
                const name = window.prompt('Bot name', 'Store FAQ');
                if (!name) return;
                await postJson('/api/bots/reply', { action: 'create', name, fallbackText: reply?.defaultFallback || '' });
              }, 'Bot created')}>
                <Plus size={16} /> New bot
              </button>
            )}
          </header>
          {canEdit && !!(reply?.templates || []).length && (
            <div className="actionCluster wa-module-wrap">
              <span className="wa-module-note">Starter templates</span>
              {(reply.templates || []).map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="secondaryAction"
                  disabled={busy}
                  onClick={() => run(
                    () => postJson('/api/bots/reply', { action: 'applyTemplate', templateId: template.id }),
                    `Created from ${template.label}`
                  )}
                >
                  {template.label}
                </button>
              ))}
            </div>
          )}
          <div className="wa-module-table">
            <table>
              <thead><tr><th>Name</th><th>Status</th><th>Rules</th><th>Priority</th><th /></tr></thead>
              <tbody>
                {(reply?.bots || []).map((bot) => (
                  <tr key={bot.id}>
                    <td><button type="button" className="linkish" onClick={() => setSelectedBot(bot.id)}>{bot.name}</button></td>
                    <td>{bot.status}</td>
                    <td>{bot.rule_count}</td>
                    <td>{bot.priority}</td>
                    <td>
                      {canEdit && bot.status !== 'published' && (
                        <button type="button" disabled={busy} onClick={() => run(() => postJson('/api/bots/reply', { action: 'setStatus', botId: bot.id, status: 'published' }), 'Published')}>Publish</button>
                      )}
                      {canEdit && bot.status === 'published' && (
                        <button type="button" disabled={busy} onClick={() => run(() => postJson('/api/bots/reply', { action: 'setStatus', botId: bot.id, status: 'paused' }), 'Paused')}>Pause</button>
                      )}
                    </td>
                  </tr>
                ))}
                {!reply?.bots?.length && <tr><td colSpan={5}>No quick reply bots yet.</td></tr>}
              </tbody>
            </table>
          </div>

          {selectedBot && (
            <>
              <h3>Rules</h3>
              <div className="wa-module-table">
                <table>
                  <thead><tr><th>When customer says</th><th>Match</th><th>Reply</th><th /></tr></thead>
                  <tbody>
                    {rules.map((rule) => (
                      <tr key={rule.id}>
                        <td>{rule.pattern}</td>
                        <td>{rule.match_type}</td>
                        <td>{rule.reply_text}</td>
                        <td className="actionCluster">
                          {canEdit && (
                            <button type="button" disabled={busy} onClick={() => setRuleForm({
                              ruleId: rule.id,
                              pattern: rule.pattern || '',
                              replyText: rule.reply_text || '',
                              matchType: rule.match_type || 'contains',
                              synonymsText: Array.isArray(rule.synonyms) ? rule.synonyms.join(', ') : ''
                            })}>Edit</button>
                          )}
                          {canEdit && (
                            <button type="button" disabled={busy} onClick={() => run(async () => {
                              await postJson('/api/bots/reply', { action: 'duplicateRule', ruleId: rule.id });
                              const refreshed = await postJson('/api/bots/reply', { action: 'listRules', botId: selectedBot });
                              setRules(refreshed.rules || []);
                            }, 'Rule duplicated')}>Duplicate</button>
                          )}
                          {canEdit && (
                            <button type="button" disabled={busy} onClick={() => run(async () => {
                              await postJson('/api/bots/reply', { action: 'deleteRule', ruleId: rule.id });
                              const refreshed = await postJson('/api/bots/reply', { action: 'listRules', botId: selectedBot });
                              setRules(refreshed.rules || []);
                            }, 'Rule deleted')}>Delete</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!rules.length && <tr><td colSpan={4}>No rules yet. Add a rule or apply a Super Admin template.</td></tr>}
                  </tbody>
                </table>
              </div>
              {canEdit && (
                <form className="formGrid" onSubmit={(event) => {
                  event.preventDefault();
                  run(async () => {
                    await postJson('/api/bots/reply', { action: 'upsertRule', botId: selectedBot, ...ruleForm });
                    setRuleForm({ ruleId: '', pattern: '', replyText: '', matchType: 'contains', synonymsText: '' });
                    const refreshed = await postJson('/api/bots/reply', { action: 'listRules', botId: selectedBot });
                    setRules(refreshed.rules || []);
                  }, ruleForm.ruleId ? 'Rule updated' : 'Rule saved');
                }}>
                  <label>When customer says<input value={ruleForm.pattern} onChange={(e) => setRuleForm((c) => ({ ...c, pattern: e.target.value }))} required /></label>
                  <label>Match type
                    <select value={ruleForm.matchType} onChange={(e) => setRuleForm((c) => ({ ...c, matchType: e.target.value }))}>
                      <option value="contains">Contains</option>
                      <option value="exact">Exact</option>
                      <option value="any_keyword">Any keyword</option>
                      <option value="regex">Regex (safe)</option>
                    </select>
                  </label>
                  <label>Synonyms (optional)<input value={ruleForm.synonymsText} onChange={(e) => setRuleForm((c) => ({ ...c, synonymsText: e.target.value }))} placeholder="price, cost, fee" /></label>
                  <label>Reply with<textarea value={ruleForm.replyText} onChange={(e) => setRuleForm((c) => ({ ...c, replyText: e.target.value }))} required rows={3} /></label>
                  <div className="actionCluster wa-module-wrap">
                    <button className="primaryAction" type="submit" disabled={busy}>
                      <Plus size={16} /> {ruleForm.ruleId ? 'Update rule' : 'Add rule'}
                    </button>
                    {ruleForm.ruleId ? (
                      <button type="button" className="secondaryAction" disabled={busy} onClick={() => setRuleForm({ ruleId: '', pattern: '', replyText: '', matchType: 'contains', synonymsText: '' })}>
                        Cancel edit
                      </button>
                    ) : null}
                  </div>
                </form>
              )}
              <form className="formGrid" onSubmit={(event) => {
                event.preventDefault();
                run(async () => {
                  const result = await postJson('/api/bots/reply', { action: 'test', botId: selectedBot, text: testText });
                  setTestResult(result.preview);
                });
              }}>
                <label>Test message<input value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="What is your price?" /></label>
                <button className="secondaryAction" type="submit" disabled={busy}><Play size={16} /> Test bot</button>
              </form>
              {testResult && (
                <p className="wa-module-note" role="status">
                  {testResult.matched ? 'Matched rule' : testResult.fallback ? 'Fallback' : 'No match'}
                  {testResult.replyText ? `: ${testResult.replyText}` : ''}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'quick' && !featureFlags?.reply_bots && (
        <p className="wa-module-note">Quick reply bots are not enabled on this plan.</p>
      )}

      {tab === 'sheets' && featureFlags?.sheets_bot && (
        <section className="wa-module">
          <header className="wa-module-heading">
            <h2>Google Sheets bot</h2>
            <button type="button" disabled={busy} onClick={() => load()}><RefreshCcw size={16} /></button>
          </header>
          {!sheets?.configured && <p className="wa-module-note" role="status">Platform Google Sheets OAuth is not configured yet. Ask your platform admin to set GOOGLE_SHEETS_CLIENT_ID / SECRET (or Google Login credentials).</p>}
          <div className="actionCluster">
            {canEdit && sheets?.connection?.status !== 'connected' && sheets?.configured && (
              <button type="button" className="primaryAction" disabled={busy} onClick={() => run(async () => {
                const result = await postJson('/api/bots/sheets', { action: 'startOAuth' });
                window.location.href = result.url;
              })}><Link2 size={16} /> Connect Google</button>
            )}
            {sheets?.connection?.status === 'connected' && (
              <p className="wa-module-note">Connected as {sheets.connection.google_account_email || 'Google account'}</p>
            )}
            {canEdit && sheets?.connection?.status === 'connected' && (
              <button type="button" className="secondaryAction" disabled={busy} onClick={() => run(() => postJson('/api/bots/sheets', { action: 'disconnect' }), 'Disconnected')}>Disconnect</button>
            )}
          </div>

          {sheets?.connection?.status === 'connected' && canEdit && (
            <form className="formGrid" onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                await postJson('/api/bots/sheets', { action: 'save', ...sheetForm });
              }, 'Sheets bot saved');
            }}>
              <label>Bot name<input value={sheetForm.name} onChange={(e) => setSheetForm((c) => ({ ...c, name: e.target.value }))} /></label>
              <label>Schema
                <select value={sheetForm.schemaId} onChange={(e) => {
                  const schemaId = e.target.value;
                  const schema = (sheets.schemas || []).find((item) => item.id === schemaId);
                  const columnMap = {};
                  (schema?.fields || []).forEach((field) => {
                    columnMap[field.key] = field.label;
                  });
                  setSheetForm((c) => ({ ...c, schemaId, columnMap: Object.keys(columnMap).length ? columnMap : c.columnMap }));
                }}>
                  {(sheets.schemas || []).map((schema) => <option key={schema.id} value={schema.id}>{schema.label}</option>)}
                </select>
              </label>
              <div className="actionCluster wa-module-wrap">
                <button type="button" className="secondaryAction" disabled={busy} onClick={() => run(async () => {
                  const result = await postJson('/api/bots/sheets', { action: 'listSpreadsheets' });
                  setFiles(result.files || []);
                })}>Load spreadsheets</button>
              </div>
              {!!files.length && (
                <label>Spreadsheet
                  <select value={sheetForm.spreadsheetId} onChange={(e) => {
                    const file = files.find((item) => item.id === e.target.value);
                    setSheetForm((c) => ({ ...c, spreadsheetId: e.target.value, spreadsheetTitle: file?.name || '' }));
                    run(async () => {
                      const meta = await postJson('/api/bots/sheets', { action: 'listSheets', spreadsheetId: e.target.value });
                      setSheetNames(meta.sheets || []);
                    });
                  }}>
                    <option value="">Select spreadsheet</option>
                    {files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
                  </select>
                </label>
              )}
              <label>Spreadsheet ID
                <input
                  value={sheetForm.spreadsheetId}
                  onChange={(e) => setSheetForm((c) => ({ ...c, spreadsheetId: e.target.value.trim() }))}
                  placeholder="From Drive URL or Load spreadsheets"
                  required
                />
              </label>
              <label>Spreadsheet title<input value={sheetForm.spreadsheetTitle} onChange={(e) => setSheetForm((c) => ({ ...c, spreadsheetTitle: e.target.value }))} /></label>
              {!!sheetNames.length ? (
                <label>Worksheet
                  <select value={sheetForm.sheetName} onChange={(e) => setSheetForm((c) => ({ ...c, sheetName: e.target.value }))}>
                    <option value="">Select worksheet</option>
                    {sheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
              ) : (
                <label>Worksheet name
                  <input value={sheetForm.sheetName} onChange={(e) => setSheetForm((c) => ({ ...c, sheetName: e.target.value }))} placeholder="Sheet1" required />
                </label>
              )}
              <label>Match mode
                <select value={sheetForm.matchMode} onChange={(e) => setSheetForm((c) => ({ ...c, matchMode: e.target.value }))}>
                  {(sheets.syncPolicy?.matchModes || ['keyword', 'exact', 'normalized']).map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </label>
              <label>Sync mode
                <select value={sheetForm.syncMode} onChange={(e) => setSheetForm((c) => ({ ...c, syncMode: e.target.value }))}>
                  <option value="poll">Automatic poll (Super Admin interval)</option>
                  <option value="manual">Manual refresh only</option>
                </select>
              </label>
              {!(sheets.schemas || []).length && (
                <p className="wa-module-note" role="status">No schema templates configured. Ask Super Admin to edit smb_sheets_schemas.</p>
              )}
              {((sheets.schemas || []).find((schema) => schema.id === sheetForm.schemaId)?.fields || []).map((field) => (
                <label key={field.key}>{field.label} column
                  <input
                    value={sheetForm.columnMap[field.key] || ''}
                    onChange={(e) => setSheetForm((c) => ({ ...c, columnMap: { ...c.columnMap, [field.key]: e.target.value } }))}
                    required={field.required === true}
                  />
                </label>
              ))}
              <label>Fallback<textarea rows={2} value={sheetForm.fallbackText} onChange={(e) => setSheetForm((c) => ({ ...c, fallbackText: e.target.value }))} /></label>
              <button className="primaryAction" type="submit" disabled={busy || !sheetForm.spreadsheetId || !sheetForm.sheetName}>
                {busy ? 'Saving…' : 'Save mapping'}
              </button>
            </form>
          )}

          <div className="wa-module-table">
            <table>
              <thead><tr><th>Name</th><th>Sheet</th><th>Status</th><th>Rows</th><th>Last sync</th><th /></tr></thead>
              <tbody>
                {(sheets?.bots || []).map((bot) => (
                  <tr key={bot.id}>
                    <td>{bot.name}</td>
                    <td>{bot.spreadsheet_title} / {bot.sheet_name}</td>
                    <td>{bot.status}</td>
                    <td>{bot.row_count}</td>
                    <td>{bot.last_synced_at ? new Date(bot.last_synced_at).toLocaleString() : '—'} {bot.last_sync_status && `(${bot.last_sync_status})`}</td>
                    <td className="actionCluster">
                      {canEdit && <button type="button" disabled={busy} onClick={() => run(() => postJson('/api/bots/sheets', { action: 'sync', botId: bot.id }), 'Synced')}>Refresh</button>}
                      {canEdit && bot.status !== 'published' && <button type="button" disabled={busy} onClick={() => run(() => postJson('/api/bots/sheets', { action: 'setStatus', botId: bot.id, status: 'published' }), 'Published')}>Activate</button>}
                      {canEdit && bot.status === 'published' && <button type="button" disabled={busy} onClick={() => run(() => postJson('/api/bots/sheets', { action: 'setStatus', botId: bot.id, status: 'paused' }), 'Paused')}>Pause</button>}
                      <button type="button" disabled={busy} onClick={() => run(async () => {
                        const text = window.prompt('Test question');
                        if (!text) return;
                        const result = await postJson('/api/bots/sheets', { action: 'test', botId: bot.id, text });
                        setTestResult(result.preview);
                      })}>Test</button>
                    </td>
                  </tr>
                ))}
                {!sheets?.bots?.length && <tr><td colSpan={6}>No Sheets bots configured.</td></tr>}
              </tbody>
            </table>
          </div>
          {testResult && tab === 'sheets' && (
            <p className="wa-module-note" role="status">
              {testResult.matched ? `Row ${testResult.rowIndex}` : testResult.fallback ? 'Fallback' : 'No match'}
              {testResult.syncVersion != null ? ` · sync v${testResult.syncVersion}` : ''}
              {testResult.replyText ? `: ${testResult.replyText}` : ''}
            </p>
          )}
          <p className="wa-module-note">
            Sync uses Google Sheets API polling about every {sheets?.syncPolicy?.pollIntervalMinutes || 5} minutes for published bots (Super Admin policy), plus Manual Refresh. Instant cell-level push is not claimed.
          </p>
        </section>
      )}
    </div>
  );
}
