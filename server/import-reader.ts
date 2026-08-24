import * as XLSX from "xlsx";

export type ImportRow=Record<string,unknown>;

function cellText(value:unknown){
  if(value==null)return "";
  if(value instanceof Date)return value.toISOString();
  return String(value).trim();
}

export function parseImportRows(buffer:Buffer,filename:string):ImportRow[]{
  try{
    const lowerName=filename.toLowerCase(),isCsv=lowerName.endsWith(".csv");
    if(lowerName.endsWith(".xlsx")&&(buffer[0]!==0x50||buffer[1]!==0x4b))throw new Error("文件内容不是有效的 XLSX 工作簿");
    if(lowerName.endsWith(".xls")&&!(buffer[0]===0xd0&&buffer[1]===0xcf&&buffer[2]===0x11&&buffer[3]===0xe0))throw new Error("文件内容不是有效的 XLS 工作簿");
    const source=isCsv?new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/,""):buffer;
    const workbook=XLSX.read(source,{type:isCsv?"string":"buffer",cellDates:true,raw:false});
    const sheetName=workbook.SheetNames[0],sheet=sheetName?workbook.Sheets[sheetName]:undefined;
    if(!sheet)throw new Error("工作簿中没有可读取的工作表");
    const matrix=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:"",raw:false,blankrows:false});
    if(!matrix.length)return [];
    const headers=(matrix[0]||[]).map(cellText),rows:ImportRow[]=[];
    for(const values of matrix.slice(1)){
      const row:ImportRow={};
      headers.forEach((header,index)=>{if(header)row[header]=values[index]??""});
      if(Object.values(row).some(value=>cellText(value)))rows.push(row);
    }
    return rows;
  }catch(error){
    throw new Error("无法读取该表格，请确认文件未加密、未损坏，并另存为 .xlsx、.xls 或 UTF-8 CSV 后重试。",{cause:error});
  }
}
