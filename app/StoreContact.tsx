import { amapPlaceUrl, normalizeAmapTel } from "./amap-contact";

export default function StoreContact({ tel, poiId }: { tel?: string | null; poiId?: string | null }) {
  const url = amapPlaceUrl(poiId);
  return <div className="store-contact">
    <span>门店电话：{normalizeAmapTel(tel) || "暂无电话"}</span>
    {url && <a href={url} target="_blank" rel="noopener noreferrer" title="打开对应高德门店页面，查看用户评价">前往高德查看评价 ↗</a>}
  </div>;
}
