import {Temporal} from '@js-temporal/polyfill';
const marker=/^PGTD-DOPL-/u;
export function reviewQuery(text,date){
 const match=/^(?:查询|查看)\s*(今天|昨天|近期|\d{4}-\d{2}-\d{2})\s*心得(?:\s+第([1-9]\d{0,3})页)?$/u.exec(text)
   ?? /^(?:查询|查看)\s*心得\s*(今天|昨天|近期|\d{4}-\d{2}-\d{2})(?:\s+第([1-9]\d{0,3})页)?$/u.exec(text);
 if(!match)return /^(?:查询|查看)/u.test(text)?{invalid:true}:null;
 try{
  const today=Temporal.PlainDate.from(date),end=match[1]==='昨天'?today.subtract({days:1}):['今天','近期'].includes(match[1])?today:Temporal.PlainDate.from(match[1]);
  if(!['今天','昨天','近期'].includes(match[1])&&end.toString()!==match[1])throw new Error();
  const page=Number(match[2]??1);if(page>1000)throw new Error();
  return {start:(match[1]==='近期'?end.subtract({days:6}):end).toString(),end:end.toString(),page};
 }catch{return {invalid:true};}
}
export function doplEntries(plaintext,year){
 const lines=plaintext.replaceAll('\r\n','\n').split('\n'),entries=[],oldDates=new Set();
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim();
  const history=/^PGTD-DOPL-HISTORY-([0-9a-f-]{36})$/u.exec(line);
  if(history){const end=lines.indexOf('PGTD-DOPL-HISTORY-END-'+history[1],i+1);if(end<0)throw new Error('LOCATION_NOT_UNIQUE');i=end;continue;}
  const block=/^PGTD-DOPL-RECORD-([0-9a-f-]{36})$/u.exec(line);
  if(block){
   const end=lines.indexOf('PGTD-DOPL-RECORD-END-'+block[1],i+1),date=/^心得日期：(\d{4}-\d{2}-\d{2})$/u.exec(lines[i+2]??'');
   if(end<i+5||lines[i+1]!=='────────'||!date||!lines[i+3]?.startsWith('记录时间：'))throw new Error('LOCATION_NOT_UNIQUE');
   try{if(Temporal.PlainDate.from(date[1]).toString()!==date[1]||Number(date[1].slice(0,4))!==year)throw new Error();}catch{throw new Error('LOCATION_NOT_UNIQUE');}
   entries.push({date:date[1],recordedAt:lines[i+3].slice(5),text:lines.slice(i+4,end).join('\n')});i=end;continue;
  }
  const heading=/^(\d{2})(\d{2})-心得$/u.exec(line);
  if(heading){
   const date=`${year}-${heading[1]}-${heading[2]}`;
   try{if(Temporal.PlainDate.from(date).toString()!==date)throw new Error();}catch{throw new Error('LOCATION_NOT_UNIQUE');}
   if(oldDates.has(date))throw new Error('LOCATION_NOT_UNIQUE');oldDates.add(date);
   let end=i+1;while(end<lines.length&&!marker.test(lines[end].trim())&&!/^\d{4}-心得$/u.test(lines[end].trim()))end++;
   entries.push({date,recordedAt:null,text:lines.slice(i+1,end).join('\n').trimEnd()});i=end-1;
  }
 }
 return entries;
}
export function queryPage(entries,query){
 const selected=entries.filter(e=>e.date>=query.start&&e.date<=query.end).sort((a,b)=>b.date.localeCompare(a.date));
 const pages=[];let page=[],chars=0;
 for(const entry of selected){const n=Array.from(entry.text).length;if(n>4500)throw new Error('CAPACITY_EXCEEDED');
  if(page.length===3||chars+n>4500){pages.push(page);page=[];chars=0;}page.push(entry);chars+=n;
 }if(page.length)pages.push(page);
 return {entries:pages[query.page-1]??[],total:selected.length,pages:pages.length,nextPage:query.page<pages.length?query.page+1:null};
}
