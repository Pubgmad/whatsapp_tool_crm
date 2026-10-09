'use client';
import {useEffect,useMemo,useState} from 'react';
import {RefreshCcw,Save} from 'lucide-react';

const days=[
  ['sun','Sunday'],['mon','Monday'],['tue','Tuesday'],['wed','Wednesday'],
  ['thu','Thursday'],['fri','Friday'],['sat','Saturday']
];

function minuteValue(value) {
  if(!Number.isInteger(value))return '';
  return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
}
function minuteNumber(value) {
  if(!/^\d{2}:\d{2}$/.test(value))return '';
  const [hour,minute]=value.split(':').map(Number);
  return hour*60+minute;
}
function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone||'';
}

export default function CallingHoursSettings({api,postJson}) {
  const endpoint='/api/workspace/calling-settings';
  const [data,setData]=useState(null),[hours,setHours]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const timezones=useMemo(()=>{
    const supported=typeof Intl.supportedValuesOf==='function'?Intl.supportedValuesOf('timeZone'):[];
    return [...new Set([hours?.timezone,browserTimezone(),...supported].filter(Boolean))];
  },[hours?.timezone]);
  async function load() {
    setBusy(true);setError('');
    try{const result=await api(endpoint);setData(result);setHours(result.callingHours);}
    catch(cause){setError(cause.message);}
    finally{setBusy(false);}
  }
  useEffect(()=>{let active=true;api(endpoint).then(result=>{if(active){setData(result);setHours(result.callingHours);}}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[api]);
  function changeMode(useSupportPolicy) {
    setHours(current=>useSupportPolicy
      ?{useSupportPolicy:true,alwaysOpen:false,timezone:'',windows:[]}
      :{useSupportPolicy:false,alwaysOpen:false,timezone:current?.timezone||browserTimezone(),windows:current?.windows||[]});
  }
  function updateDay(day,enabled) {
    setHours(current=>({...current,windows:enabled?[...current.windows,{day,startMinute:'',endMinute:''}]:current.windows.filter(row=>row.day!==day)}));
  }
  function updateWindow(day,key,value) {
    setHours(current=>({...current,windows:current.windows.map(row=>row.day===day?{...row,[key]:minuteNumber(value)}:row)}));
  }
  async function save(event) {
    event.preventDefault();setBusy(true);setError('');
    try{const result=await postJson(endpoint,{callingHours:hours},'PATCH');setData(result);setHours(result.callingHours);}
    catch(cause){setError(cause.message);}
    finally{setBusy(false);}
  }
  return <details><summary>Calling hours policy</summary>
    {error&&<p role="alert" className="wa-module-error">{error}</p>}
    {!hours?<p role="status">Loading calling hours...</p>:<form onSubmit={save}>
      <fieldset disabled={busy}>
        <legend>Hours source</legend>
        <label><input type="radio" name="calling-hours-source" checked={hours.useSupportPolicy} disabled={!data?.supportPolicyAvailable} onChange={()=>changeMode(true)}/> Use support-policy business hours</label>
        {!data?.supportPolicyAvailable&&<small>Configure a support policy before selecting its business hours.</small>}
        <label><input type="radio" name="calling-hours-source" checked={!hours.useSupportPolicy} onChange={()=>changeMode(false)}/> Use dedicated calling hours</label>
      </fieldset>
      {!hours.useSupportPolicy && <fieldset>
        <legend>Dedicated calling hours</legend>
        <label>Time zone<select required value={hours.timezone} onChange={(event) => setHours({ ...hours, timezone: event.target.value })}><option value="">Select time zone</option>{timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}</select></label>
        <label><input type="checkbox" checked={hours.alwaysOpen} onChange={(event) => setHours({ ...hours, alwaysOpen: event.target.checked, windows: event.target.checked ? [] : hours.windows })} /> Open at all times</label>
        {!hours.alwaysOpen && days.map(([day, label]) => {
          const slot = hours.windows.find((row) => row.day === day);
          return (
            <div className="wa-calling-hours-row" key={day}>
              <label><input type="checkbox" checked={Boolean(slot)} onChange={(event) => updateDay(day, event.target.checked)} /> {label}</label>
              {slot ? (
                <>
                  <label>Opens<input aria-label={label + ' calling opens'} required type="time" value={minuteValue(slot.startMinute)} onChange={(event) => updateWindow(day, 'startMinute', event.target.value)} /></label>
                  <label>Closes<input aria-label={label + ' calling closes'} required type="time" value={minuteValue(slot.endMinute)} onChange={(event) => updateWindow(day, 'endMinute', event.target.value)} /></label>
                </>
              ) : null}
            </div>
          );
        })}
      </fieldset>}
      {data?.preview&&<div className="wa-calling-hours-preview" role="status"><strong>{data.preview.open?'Calling is open now':'Calling is closed now'}</strong><span>{data.preview.timezone?` Evaluated in ${data.preview.timezone}.`:''} {data.preview.closedBehavior}</span></div>}
      <div className="wa-module-controls"><button type="submit" disabled={busy}><Save size={16}/>Save calling hours</button><button type="button" disabled={busy} onClick={load}><RefreshCcw size={16}/>Reload preview</button></div>
    </form>}
  </details>;
}
