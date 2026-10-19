export function nextWeeklyRefresh(weekday:number,hour:number,minute:number,now=new Date()){
 const local=new Date(now.getTime()+8*3600000),days=(weekday-local.getUTCDay()+7)%7;
 let next=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+days,hour,minute)-8*3600000;
 if(next<=now.getTime())next+=7*86400000;return new Date(next);
}
export function validateRefreshSchedule(body:Record<string,unknown>){
 const weekday=Number(body.weekday),hour=Number(body.hour),minute=Number(body.minute);
 if(typeof body.enabled!=="boolean"||!Number.isInteger(weekday)||weekday<0||weekday>6||!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59)throw new Error("请填写有效的每周执行时间");
 return {enabled:body.enabled,weekday,hour,minute};
}
