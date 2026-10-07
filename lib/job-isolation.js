export function jobFailureCode(error) {
  const value=String(error?.code||'');
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(value)?value:'JOB_FAILED';
}

export async function runIsolatedJobs(tasks,onFailure=()=>{},concurrency=1) {
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new TypeError('Invalid queue concurrency');
  const results={};
  const errors={};
  let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},async()=>{
    while(next<tasks.length){
      const [name,run]=tasks[next++];
      try{results[name]=await run();}
      catch(error){
        errors[name]=jobFailureCode(error);
        onFailure(name,errors[name]);
      }
    }
  }));
  return {results,errors};
}
