"use client";
import {useEffect} from "react";
export default function ClientTelemetry(){
  useEffect(()=>{
    let count=0;
    const send=(message:string,filename="",line=0,column=0)=>{if(count++>=5)return;void fetch(`${process.env.NEXT_PUBLIC_API_URL||"/api"}/telemetry/client`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:message.slice(0,800),path:location.pathname,filename:filename.split(/[?#]/)[0],line,column}),keepalive:true}).catch(()=>{})};
    const error=(event:ErrorEvent)=>send(event.message,event.filename,event.lineno,event.colno);
    const rejection=(event:PromiseRejectionEvent)=>send(event.reason instanceof Error?event.reason.message:"未处理的异步错误");
    window.addEventListener("error",error);window.addEventListener("unhandledrejection",rejection);
    return()=>{window.removeEventListener("error",error);window.removeEventListener("unhandledrejection",rejection)};
  },[]);return null;
}
