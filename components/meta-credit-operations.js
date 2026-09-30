'use client';
import {useEffect,useState} from 'react';
import {RefreshCcw,WalletCards} from 'lucide-react';
import './meta-credit-operations.css';

export default function MetaCreditOperations({api}) {
  const [state,setState]=useState(null),[error,setError]=useState(''),[result,setResult]=useState(''),[loading,setLoading]=useState(false);
  const load=async()=>{setLoading(true);setError('');try {setState(await api('/api/super-admin/meta-credit-lines'));} catch(cause){setError(cause.message);} finally {setLoading(false);}};
  useEffect(()=>{let active=true;api('/api/super-admin/meta-credit-lines').then(value=>{if(active)setState(value);}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[api]);
  const share=async(event)=>{
    event.preventDefault();const form=event.currentTarget,values=new FormData(form);
    setLoading(true);setError('');setResult('');
    try {
      const response=await api('/api/super-admin/meta-credit-lines',{method:'POST',body:JSON.stringify({accountId:values.get('accountId'),creditLineId:values.get('creditLineId'),confirmation:values.get('confirmation'),retryRejected:values.get('retryRejected')==='on'})});
      setResult('Credit sharing: '+response.status);form.reset();await load();
    } catch(cause){setError(cause.message);} finally {setLoading(false);}
  };
  const reconcile=async(operation)=>{
    const allocationId=operation.allocation_id||window.prompt('Allocation ID from Meta');
    if(!allocationId)return;
    setLoading(true);setError('');
    try{await api('/api/super-admin/meta-credit-lines',{method:'POST',body:JSON.stringify({action:'reconcile',operationId:operation.id,allocationId})});await load();setResult('Credit allocation verified.');}
    catch(cause){setError(cause.message);}finally{setLoading(false);}
  };
  return <section>
    {error&&<p className='errorLine' role='alert'>{error}</p>}{result&&<p role='status'>{result}</p>}
    {state&&!state.configured&&<p>Platform Meta credentials are not configured.</p>}
    {state?.configured&&<>
      <div className='statusStack'>{state.creditLines.map(line=><div key={line.id}><span>{line.legalEntityName}</span><strong>{line.id}</strong></div>)}{!state.creditLines.length&&<p>No credit lines returned by Meta.</p>}</div>
      {state.sharingEnabled&&<form className='formGrid' onSubmit={share}>
        <label>Platform credit line<select name='creditLineId' required><option value=''>Select credit line</option>{state.creditLines.map(line=><option key={line.id} value={line.id}>{line.legalEntityName} ({line.id})</option>)}</select></label>
        <label>Customer WhatsApp account<select name='accountId' required><option value=''>Select WhatsApp account</option>{state.accounts.map(account=><option key={account.id} value={account.id}>{account.company_name} ({account.waba_id})</option>)}</select></label>
        <label>Confirm customer WABA ID<input name='confirmation' pattern='[0-9]{1,32}' required autoComplete='off'/></label>
        <label className='checkRow'><input type='checkbox' required/> I authorize this platform to accept Meta billing liability for this account.</label>
        <label className='checkRow'><input type='checkbox' name='retryRejected'/> Retry a previously rejected operation</label>
        <button type='submit' className='primaryAction' disabled={loading||!state.creditLines.length}><WalletCards size={16}/> Share credit line</button>
      </form>}
      <div className='creditOperationsTable'><table><thead><tr><th>WABA</th><th>Credit line</th><th>Currency</th><th>Status</th><th>Allocation</th></tr></thead><tbody>{state.operations.map(operation=><tr key={operation.id}><td>{operation.waba_id}</td><td>{operation.credit_line_id}</td><td>{operation.currency}</td><td>{operation.status}{operation.error_code&&<small>{operation.error_code}</small>}</td><td>{operation.allocation_id||'-'}<button className='iconButton' title='Reconcile allocation' aria-label='Reconcile allocation' disabled={loading} onClick={()=>reconcile(operation)}><RefreshCcw size={16}/></button>{operation.reconciled_at&&<small>{new Date(operation.reconciled_at).toLocaleString()}</small>}{operation.reconciliation?.allocation&&<details><summary>Meta allocation</summary><pre>{JSON.stringify(operation.reconciliation,null,2)}</pre></details>}</td></tr>)}{!state.operations.length&&<tr><td colSpan={5}>No credit-sharing operations</td></tr>}</tbody></table></div>
    </>}
    <button className='secondaryAction' type='button' disabled={loading} onClick={load}><RefreshCcw size={16}/> Refresh</button>
  </section>;
}
