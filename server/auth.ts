import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { query } from "./db.js";

export type AuthUser={id:number;tenantId:number;email:string;displayName:string;role:"admin"|"member"};
declare module "express-serve-static-core" { interface Request { user?:AuthUser } }

const COOKIE="storemap_session";
const hours=Number(process.env.SESSION_HOURS||12);
const hash=(value:string)=>crypto.createHash("sha256").update(value).digest("hex");

export async function createSession(userId:number,res:Response){
  const token=crypto.randomBytes(32).toString("base64url"),expires=new Date(Date.now()+hours*3600_000);
  await query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,$3)",[userId,hash(token),expires]);
  res.cookie(COOKIE,token,{httpOnly:true,sameSite:"lax",secure:process.env.COOKIE_SECURE==="true",maxAge:hours*3600_000,path:"/"});
}

export async function destroySession(req:Request,res:Response){const token=req.cookies?.[COOKIE];if(token)await query("DELETE FROM sessions WHERE token_hash=$1",[hash(token)]);res.clearCookie(COOKIE,{path:"/"})}

export async function authenticate(req:Request,res:Response,next:NextFunction){
  try{const token=req.cookies?.[COOKIE];if(!token)return res.status(401).json({success:false,message:"请先登录"});const result=await query<{id:number;tenant_id:number;email:string;display_name:string;role:"admin"|"member"}>("SELECT u.id,u.tenant_id,u.email,u.display_name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.active=TRUE",[hash(token)]);const row=result.rows[0];if(!row)return res.status(401).json({success:false,message:"登录已过期，请重新登录"});req.user={id:Number(row.id),tenantId:Number(row.tenant_id),email:row.email,displayName:row.display_name,role:row.role};void query("UPDATE sessions SET last_seen_at=NOW() WHERE token_hash=$1",[hash(token)]);next()}catch(error){next(error)}
}

export function requireAdmin(req:Request,res:Response,next:NextFunction){if(req.user?.role!=="admin")return res.status(403).json({success:false,message:"需要管理员权限"});next()}
export async function verifyPassword(email:string,password:string){const result=await query<{id:number;password_hash:string;active:boolean}>("SELECT id,password_hash,active FROM users WHERE lower(email)=lower($1) ORDER BY id LIMIT 1",[email]);const user=result.rows[0];return user&&user.active&&await bcrypt.compare(password,user.password_hash)?Number(user.id):null}
