export const DEFAULT_SNACK_BRANDS = [
  {name:"零食很忙",aliases:["零食很忙"]}, {name:"零食有鸣",aliases:["零食有鸣"]},
  {name:"赵一鸣零食",aliases:["赵一鸣零食","赵一鸣"]},
  {name:"好想来",aliases:["好想来零食乐园","好想来品牌零食","好想来零食","好像来零食","好想来","好像来"]},
  {name:"爱零食",aliases:["爱零食"]}, {name:"来优品",aliases:["来优品"]},
  {name:"戴永红",aliases:["戴永红"]}, {name:"糖巢",aliases:["糖巢"]},
  {name:"老婆大人",aliases:["老婆大人"]}, {name:"陆小馋",aliases:["陆小馋"]},
  {name:"吖嘀吖嘀",aliases:["吖嘀吖嘀"]}, {name:"来伊份",aliases:["来伊份"]},
  {name:"零食悦",aliases:["零食悦"]},
];
export const LEGACY_HAOXIANGLAI = ["好想来零食","好像来零食","好像来"];
export const RETIRED_SNACK_BRANDS = ["良品铺子","零食优选","零食好能嗨","零食很能嗨","零食优选、零食悦、零食很能嗨","零食优选、零食悦、零食好能嗨"];
export function canonicalSnackBrand(name:string) {
  return LEGACY_HAOXIANGLAI.includes(name) ? "好想来" : name;
}
export function isRetiredSnackBrand(name:string) {
  return RETIRED_SNACK_BRANDS.includes(name) || (/[、，,]/.test(name) && /零食优选|零食好能嗨|零食很能嗨/.test(name));
}
