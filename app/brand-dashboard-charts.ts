import * as echarts from "echarts/core";
import {BarChart,MapChart} from "echarts/charts";
import {GridComponent,TooltipComponent,VisualMapComponent,DataZoomComponent} from "echarts/components";
import {CanvasRenderer} from "echarts/renderers";
echarts.use([BarChart,MapChart,GridComponent,TooltipComponent,VisualMapComponent,DataZoomComponent,CanvasRenderer]);
export {echarts};
