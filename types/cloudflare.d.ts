/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
declare module "cloudflare:workers" { export const env: Record<string, any>; }
interface Fetcher { fetch(input:Request):Promise<Response>; }
interface D1Database {}
