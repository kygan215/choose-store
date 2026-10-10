export const excludedLabelFixtures = [
  ...["公司","培训机构","农副产品","住宅区","化妆品","日杂店","住宿服务"].flatMap(tag => [
    {brand:"糖巢",name:"糖巢(中心店)",type:"购物服务;专卖店;专营店",tag,expected:"排除"},
    {brand:"糖巢",name:"糖巢(中心店)",type:tag,expected:"排除"},
    {brand:"糖巢",name:"糖巢(中心店)",type:"购物服务",business:{keytag:tag},expected:"排除"},
  ]),
  ...["好想来副食","好想来副食品店(柳州路店)","好想来·副食店","好想来新城副食品店"].map(name=>({brand:"好想来",name,type:"购物服务",tag:"零食",expected:"排除"})),
  {brand:"好想来",name:"好想来全食优选(兴化吾悦广场店)",type:"餐饮服务",expected:"接受"},
  {brand:"好想来",name:"好想来全食优选(中心店)",type:"购物服务",tag:"日杂店",expected:"排除"},
  {brand:"好想来",name:"好想来全食优选(中心店)",type:"住宿服务",tag:"零食",expected:"接受"},
  {brand:"好想来",name:"好想来全食优选(中心店)",expected:"待核实"},
  {brand:"好想来",name:"好想来(副食品店旁店)",type:"购物服务",tag:"零食",expected:"接受"},
  {brand:"糖巢",name:"糖巢(培训机构旁店)",type:"购物服务",tag:"零食",expected:"接受"},
  {brand:"糖巢",name:"糖巢(中心店)",type:"购物服务",tag:"零食; 日杂店 ",expected:"排除"},
  {brand:"糖巢",name:"糖巢(中心店)",type:"购物服务",business:{rectag:"日杂店"},expected:"排除"},
  {brand:"糖巢",name:"糖巢(中心店)",type:"购物服务",business:{tag:"日杂店"},expected:"排除"},
];
