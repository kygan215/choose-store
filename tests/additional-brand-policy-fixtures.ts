import {CONFIRMED_ADDITIONAL_BRANDS} from "../shared/brand-store-policy.js";
export const additionalBrandFixtures=CONFIRMED_ADDITIONAL_BRANDS.flatMap(brand=>[
 ...["零食","超市","便利店","折扣店","购物"].map(tag=>({brand,name:`${brand}(中心店)`,type:"",tag,expected:"接受" as const})),
 ...[brand,`${brand}零食`,`${brand}零食超市`,`${brand}量贩零食`,`${brand}超市(中心店)`,`${brand}便利店(中心店)`,`${brand}折扣店(中心店)`,`${brand}（中心店）`].map(name=>({brand,name,type:"购物服务",tag:"零食",expected:"接受" as const})),
 ...["餐馆","蛋糕店","生鲜超市","足疗","公司","住宅区"].map(tag=>({brand,name:`${brand}(中心店)`,type:"购物服务",tag,expected:brand==="优味多"&&["餐馆","蛋糕店","生鲜超市"].includes(tag)?"接受" as const:"待核实" as const})),
 {brand,name:`${brand}(中心店)`,type:"餐饮服务;糕饼店;糕饼店",tag:"",expected:brand==="优味多"?"接受" as const:"待核实" as const},
 {brand,name:`${brand}(中心店)`,type:"餐饮服务;糕饼店;糕饼店",tag:"零食",expected:"接受" as const},
 {brand,name:`${brand}(中心店)`,type:"购物服务",tag:"零食;蛋糕店",expected:brand==="优味多"?"接受" as const:"待核实" as const},
 {brand,name:`${brand}(中心店)`,type:"",tag:"",expected:"待核实" as const},
 ...[`${brand}蛋糕店`,`${brand}(配送仓库)`,`${brand}(中心店)(装修中)`,`普通便利店(${brand}旁)`,`天猫优品(中心店)`].map(name=>({brand,name,type:"购物服务",tag:"零食",expected:"排除" as const})),
 {brand,name:`${brand}陌生后缀`,type:"购物服务",tag:"零食",expected:"待核实" as const},
]);
