import { Queue, QueueEvents } from "bullmq";

export const redisUrl=process.env.REDIS_URL||"redis://redis:6379";
const parsed=new URL(redisUrl);
export const redisConnection={host:parsed.hostname,port:Number(parsed.port||6379),password:parsed.password||undefined,db:Number(parsed.pathname.slice(1)||0),maxRetriesPerRequest:null};
export const taskQueue=new Queue("store-analysis",{connection:redisConnection,defaultJobOptions:{attempts:3,backoff:{type:"exponential",delay:1000},removeOnComplete:500,removeOnFail:1000}});
export const taskEvents=new QueueEvents("store-analysis",{connection:redisConnection});

export async function enqueueAndWait<T>(name:string,data:Record<string,unknown>,timeout=180_000){const job=await taskQueue.add(name,data);return job.waitUntilFinished(taskEvents,timeout) as Promise<T>}
