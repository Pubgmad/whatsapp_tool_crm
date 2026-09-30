'use client';
import {useState} from 'react';
import {RefreshCcw,Link2,Ban} from 'lucide-react';

export default function RazorpaySubscriptionActions({postJson,role,plans=[],interval}){
  const [pending,setPending]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  async function run(body){
    setPending(true);setError('');setMessage('');
    try{
      const result=await postJson('/api/billing/razorpay',body);
      setMessage(body.action==='cancel'?(result.cancelAtPeriodEnd?'Cancellation scheduled for the end of the paid period.':'Subscription cancelled.'):'Subscription verified. '+(result.status||''));
    }catch(failure){setError(failure.message);}finally{setPending(false);}
  }
  if(role!=='Owner')return null;
  return <section className="billingActions" aria-label="Razorpay subscription">
    <div className="rowActions">
      <button className="secondaryAction" type="button" disabled={pending} onClick={()=>run({action:'refresh'})}><RefreshCcw size={16}/> Refresh Razorpay status</button>
      <button className="secondaryAction dangerSoft" type="button" disabled={pending} onClick={()=>{if(window.confirm('Cancel this subscription? Active subscriptions remain available until the paid period ends.'))run({action:'cancel'});}}><Ban size={16}/> Cancel subscription</button>
    </div>
    <details><summary>Recover an unconfirmed checkout</summary><form className="formGrid" onSubmit={event=>{event.preventDefault();run({action:'recover',subscriptionId:new FormData(event.currentTarget).get('subscriptionId')});}}>
      <label>Unconfirmed checkout subscription ID<input name="subscriptionId" pattern="sub_[A-Za-z0-9]+" required autoComplete="off"/></label>
      <button className="secondaryAction" disabled={pending}><Link2 size={16}/> Recover checkout</button>
    </form></details>
    <details><summary>Recover an unconfirmed billing plan</summary><form className="formGrid" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);run({action:'recoverPlan',planId:form.get('planId'),providerPlanId:form.get('providerPlanId'),interval});}}>
      <label>Unconfirmed billing plan<select name="planId" required><option value="">Select plan</option>{plans.map(plan=><option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
      <label>Razorpay plan ID<input name="providerPlanId" pattern="plan_[A-Za-z0-9]+" required autoComplete="off"/></label>
      <button className="secondaryAction" disabled={pending}><Link2 size={16}/> Recover billing plan</button>
    </form></details>
    {error&&<div className="formError" role="alert">{error}</div>}
    {message&&<div className="formSuccess" role="status">{message}</div>}
  </section>;
}
