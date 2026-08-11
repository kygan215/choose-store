import pg from "pg";

const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_SIZE || 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text:string,values:unknown[]=[]){
  return pool.query<T>(text,values);
}

export async function audit(tenantId:number,userId:number|null,action:string,targetType:string,targetId:string|number|null,ip:string,details:Record<string,unknown>={}){
  await query("INSERT INTO audit_logs(tenant_id,user_id,action,target_type,target_id,ip_address,details) VALUES($1,$2,$3,$4,$5,$6,$7)",[tenantId,userId,action,targetType,targetId==null?null:String(targetId),ip,details]);
}

export async function closeDb(){await pool.end()}
