import {AppError} from './db.js';

export function validateSupportPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('Invalid support policy.',400,'VALIDATION_ERROR');
  const {enabled,mode,scope,timezone,alwaysOpen,agentIds,maxOpen,slaMinutes,escalationUserId}=value;
  if (typeof enabled!=='boolean' || typeof alwaysOpen!=='boolean' || !['manual','round_robin','least_loaded'].includes(mode) || !['unassigned','handoff'].includes(scope)) throw new AppError('Choose a valid routing policy.',400,'VALIDATION_ERROR');
  try {new Intl.DateTimeFormat('en',{timeZone:timezone}).format();} catch {throw new AppError('Enter a valid time zone.',400,'VALIDATION_ERROR');}
  if (typeof timezone!=='string' || !timezone.trim() || !Number.isInteger(maxOpen) || maxOpen<1 || maxOpen>10000 || !Number.isInteger(slaMinutes) || slaMinutes<1 || slaMinutes>10080) throw new AppError('Enter valid capacity and SLA values.',400,'VALIDATION_ERROR');
  if (!Array.isArray(agentIds) || agentIds.length>500 || agentIds.some(id=>typeof id!=='string' || !id) || new Set(agentIds).size!==agentIds.length || (enabled && mode!=='manual' && !agentIds.length)) throw new AppError('Select eligible team members.',400,'VALIDATION_ERROR');
  const hours=value.hours;
  if (!Array.isArray(hours) || hours.length>7 || new Set(hours.map(row=>row.day)).size!==hours.length || hours.some(row=>!Number.isInteger(row.day)||row.day<0||row.day>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.end)||row.start>=row.end) || (enabled&&!alwaysOpen&&!hours.length)) throw new AppError('Set non-overlapping same-day opening hours.',400,'VALIDATION_ERROR');
  if (escalationUserId!=null && typeof escalationUserId!=='string') throw new AppError('Invalid escalation member.',400,'VALIDATION_ERROR');
  return {enabled,mode,scope,timezone,alwaysOpen,agentIds,maxOpen,slaMinutes,escalationUserId:escalationUserId||null,hours:hours.map(({day,start,end})=>({day,start,end}))};
}

export function supportIsOpen(policy,date=new Date()) {
  if (policy.alwaysOpen) return true;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:policy.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get=key=>parts.find(part=>part.type===key)?.value;
  const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
  const time=get('hour')+':'+get('minute');
  return policy.hours.some(row=>row.day===day&&time>=row.start&&time<row.end);
}
