import {AppError,id,query,transaction} from './db.js';
import {decryptSecret} from './meta.js';
import {googleAccessToken,GOOGLE_EVENTS_SCOPE} from './external-availability.js';

const calendarEventUrl=(calendar,eventId='')=>`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar)}/events${eventId?'/'+encodeURIComponent(eventId):''}`;

export function calendarEventBody(job){
  const snapshot=job.snapshot;
  if(!snapshot?.starts_at||!snapshot?.ends_at||!job.external_id||!job.reservation_id)throw new AppError('Booking data is incomplete.',409,'CALENDAR_BOOKING_INVALID');
  if(!Number.isFinite(Date.parse(snapshot.starts_at))||!Number.isFinite(Date.parse(snapshot.ends_at))||Date.parse(snapshot.ends_at)<=Date.parse(snapshot.starts_at))throw new AppError('Booking time is invalid.',409,'CALENDAR_BOOKING_INVALID');
  return {
    id:job.external_id,
    summary:String(snapshot.title||'').slice(0,80),
    start:{dateTime:new Date(snapshot.starts_at).toISOString()},
    end:{dateTime:new Date(snapshot.ends_at).toISOString()},
    extendedProperties:{private:{crmReservationId:job.reservation_id,crmBusinessId:job.business_id}}
  };
}

async function calendarFetch(url,options,fetcher=fetch){
  try{return await fetcher(url,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});}
  catch{throw new AppError('Calendar request outcome is unknown.',503,'CALENDAR_RETRY');}
}

async function ownedCalendarEvent(job,token,fetcher){
  const response=await calendarFetch(calendarEventUrl(job.external_target,job.external_id),{method:'GET',headers:{authorization:`Bearer ${token}`}},fetcher);
  if(response.status===404)return null;
  if(response.status===401||response.status===403)throw new AppError('Reconnect Google Calendar.',409,'AVAILABILITY_REAUTHORIZE');
  if(!response.ok)throw new AppError('Calendar event could not be verified.',503,'CALENDAR_RETRY');
  let record;try{record=await response.json();}catch{throw new AppError('Calendar event could not be verified.',503,'CALENDAR_RETRY');}
  if(record.id!==job.external_id||record.extendedProperties?.private?.crmReservationId!==job.reservation_id||record.extendedProperties?.private?.crmBusinessId!==job.business_id)throw new AppError('Calendar event ID is already in use.',409,'CALENDAR_EVENT_CONFLICT');
  return record;
}

async function calendarIsFree(job,token,fetcher){
  const snapshot=job.snapshot;
  const response=await calendarFetch('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({timeMin:new Date(snapshot.starts_at).toISOString(),timeMax:new Date(snapshot.ends_at).toISOString(),items:[{id:job.external_target}]})},fetcher);
  if(response.status===401||response.status===403)throw new AppError('Reconnect Google Calendar.',409,'AVAILABILITY_REAUTHORIZE');
  if(!response.ok)throw new AppError('Calendar availability could not be verified.',503,'CALENDAR_RETRY');
  let data;try{data=await response.json();}catch{throw new AppError('Calendar availability could not be verified.',503,'CALENDAR_RETRY');}
  const calendar=data.calendars?.[job.external_target];
  if(!calendar||calendar.errors?.length||!Array.isArray(calendar.busy))throw new AppError('Calendar availability could not be verified.',503,'CALENDAR_RETRY');
  return calendar.busy.length===0;
}

export async function createCalendarBooking(job,{fetcher=fetch,accessToken}={}){
  if(!job.granted_scopes?.includes(GOOGLE_EVENTS_SCOPE)||!job.refresh_encrypted)throw new AppError('Reconnect Google Calendar with booking access.',409,'AVAILABILITY_REAUTHORIZE');
  const token=accessToken||await googleAccessToken(decryptSecret(job.refresh_encrypted));
  if(await ownedCalendarEvent(job,token,fetcher))return job.external_id;
  if(Date.parse(job.snapshot?.starts_at)<=Date.now())throw new AppError('Booking slot has already started.',409,'CALENDAR_BOOKING_REJECTED');
  if(!(await calendarIsFree(job,token,fetcher)))throw new AppError('Calendar slot is no longer available.',409,'CALENDAR_BOOKING_REJECTED');
  const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
  const response=await calendarFetch(calendarEventUrl(job.external_target),{method:'POST',headers,body:JSON.stringify(calendarEventBody(job))},fetcher);
  if(response.status===409){
    const record=await ownedCalendarEvent(job,token,fetcher);
    if(!record)throw new AppError('Calendar duplicate could not be verified.',503,'CALENDAR_RETRY');
    return job.external_id;
  }
  if(response.status===401||response.status===403)throw new AppError('Reconnect Google Calendar.',409,'AVAILABILITY_REAUTHORIZE');
  if(response.status===429||response.status>=500)throw new AppError('Calendar is temporarily unavailable.',503,'CALENDAR_RETRY');
  if(!response.ok)throw new AppError('Calendar rejected this booking.',409,'CALENDAR_BOOKING_REJECTED');
  let created;try{created=await response.json();}catch{throw new AppError('Calendar response could not be verified.',503,'CALENDAR_RETRY');}
  if(created.id!==job.external_id)throw new AppError('Calendar event identity could not be verified.',503,'CALENDAR_RETRY');
  return created.id;
}

export async function cancelCalendarBooking(job,{fetcher=fetch,accessToken}={}){
  if(!job.granted_scopes?.includes(GOOGLE_EVENTS_SCOPE)||!job.refresh_encrypted)throw new AppError('Reconnect Google Calendar with booking access.',409,'AVAILABILITY_REAUTHORIZE');
  const token=accessToken||await googleAccessToken(decryptSecret(job.refresh_encrypted));
  if(!(await ownedCalendarEvent(job,token,fetcher)))return job.external_id;
  const response=await calendarFetch(calendarEventUrl(job.external_target,job.external_id),{method:'DELETE',headers:{authorization:`Bearer ${token}`}},fetcher);
  if(response.status===404||response.status===410||response.ok)return job.external_id;
  if(response.status===401||response.status===403)throw new AppError('Reconnect Google Calendar.',409,'AVAILABILITY_REAUTHORIZE');
  throw new AppError('Calendar cancellation outcome is unknown.',503,'CALENDAR_RETRY');
}

export async function runCalendarFulfillment(){
  const claimed=await query(`WITH due AS (
    SELECT reservation_id FROM availability_fulfillments
    WHERE (status IN ('pending','cancel_pending') AND next_attempt_at<=NOW()) OR (status IN ('processing','cancelling') AND claimed_at<NOW()-INTERVAL '2 minutes')
    ORDER BY next_attempt_at,reservation_id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE availability_fulfillments f SET status=CASE WHEN f.requested_action='cancel' THEN 'cancelling' ELSE 'processing' END,attempts=f.attempts+1,claimed_at=NOW(),updated_at=NOW()
    FROM due WHERE f.reservation_id=due.reservation_id RETURNING f.reservation_id,f.business_id,f.attempts,f.requested_action`,[]);
  if(!claimed.rowCount)return {claimed:0};
  const claim=claimed.rows[0];
  const job=(await query(`SELECT f.*,r.snapshot,c.refresh_encrypted,c.granted_scopes,c.enabled
    FROM availability_fulfillments f
    JOIN flow_runtime_reservations r ON r.id=f.reservation_id AND r.business_id=f.business_id
    LEFT JOIN availability_connections c ON c.id=f.connection_id AND c.business_id=f.business_id
    WHERE f.reservation_id=$1 AND f.business_id=$2 AND f.attempts=$3`,[claim.reservation_id,claim.business_id,claim.attempts])).rows[0];
  try{
    if(!job?.enabled)throw new AppError('Reconnect the calendar for this booking.',409,'AVAILABILITY_REAUTHORIZE');
    if(claim.requested_action==='cancel')await cancelCalendarBooking(job);
    else await createCalendarBooking(job);
    const settled=await transaction(async client=>{
      const cancelling=claim.requested_action==='cancel';
      const updated=await client.query(`UPDATE availability_fulfillments SET status=$1,last_error=NULL,claimed_at=NULL,updated_at=NOW()
        WHERE reservation_id=$2 AND business_id=$3 AND status=$4 AND requested_action=$5 AND attempts=$6 RETURNING reservation_id`,[cancelling?'cancelled':'confirmed',claim.reservation_id,claim.business_id,cancelling?'cancelling':'processing',claim.requested_action,claim.attempts]);
      if(!updated.rowCount)return false;
      const reservation=await client.query(`UPDATE flow_runtime_reservations SET status=$1 WHERE id=$2 AND business_id=$3 AND status=$4
        RETURNING session_id`,[cancelling?'cancelled':'confirmed',claim.reservation_id,claim.business_id,cancelling?'cancel_pending':'pending_external']);
      if(reservation.rowCount){
        await client.query(`INSERT INTO events(id,business_id,type,contact_id,metadata)
          SELECT $1,$2,$3,s.contact_id,$4 FROM flow_runtime_sessions s
          WHERE s.id=$5 AND s.business_id=$2`,[id('e'),claim.business_id,cancelling?'whatsapp_flow_booking_cancelled':'whatsapp_flow_booking_confirmed',JSON.stringify({reservationId:claim.reservation_id,calendarEventId:job.external_id}),reservation.rows[0].session_id]);
        await client.query(`INSERT INTO availability_booking_notices(reservation_id,business_id,kind,template_id)
          SELECT $1,$2,$3,n.template_id FROM availability_booking_notice_rules n
          WHERE n.business_id=$2 AND n.kind=$3 AND n.enabled ON CONFLICT(reservation_id,kind) DO NOTHING`,[claim.reservation_id,claim.business_id,cancelling?'cancelled':'confirmed']);
      }
      return true;
    });
    return settled?{claimed:1,confirmed:claim.requested_action==='create'?1:0,cancelled:claim.requested_action==='cancel'?1:0}:{claimed:1,confirmed:0,status:'changed'};
  }catch(error){
    const terminal=error?.code==='CALENDAR_BOOKING_REJECTED'||error?.code==='CALENDAR_BOOKING_INVALID'||error?.code==='CALENDAR_EVENT_CONFLICT';
    const status=error?.code==='AVAILABILITY_REAUTHORIZE'?'needs_reconnect':terminal?'failed':claim.requested_action==='cancel'?'cancel_pending':'pending';
    await transaction(async client=>{
      const changed=await client.query(`UPDATE availability_fulfillments SET status=$1,last_error=$2,claimed_at=NULL,
        next_attempt_at=NOW()+LEAST(3600,POWER(2,LEAST(attempts,11))::integer)*INTERVAL '1 second',updated_at=NOW()
        WHERE reservation_id=$3 AND business_id=$4 AND status=$5 AND requested_action=$6 AND attempts=$7 RETURNING reservation_id`,[status,String(error?.code||'CALENDAR_RETRY').slice(0,80),claim.reservation_id,claim.business_id,claim.requested_action==='cancel'?'cancelling':'processing',claim.requested_action,claim.attempts]);
      if(changed.rowCount&&status==='failed'&&claim.requested_action==='create')await client.query("UPDATE flow_runtime_reservations SET status='external_failed' WHERE id=$1 AND business_id=$2 AND status='pending_external'",[claim.reservation_id,claim.business_id]);
    });
    return {claimed:1,confirmed:0,status};
  }
}
