import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { queryCurrentOkr } from '../src/okr-query.js';
import { callNotes } from '../src/apple-notes.js';
// No session initialization, owner changes, Notes writes, model or Feishu calls.
let db;
try {
  const { values }=parseArgs({options:{'state-path':{type:'string'}}});
  if(!values['state-path']) throw new Error('STATE_PATH_REQUIRED');
  db=new DatabaseSync(values['state-path'],{readOnly:true,timeout:1000});
  db.exec('BEGIN');
  const get=key=>{const row=db.prepare('SELECT value FROM records WHERE key=?').get(key);return row?JSON.parse(row.value):undefined;};
  const input={latest:get('latest'),binding:get('note'),location:get('config'),pending:get('publication')};
  db.exec('COMMIT');db.close();db=null;
  const started=performance.now();
  const result=await queryCurrentOkr({...input,bridge:callNotes});
  console.log(JSON.stringify({mode:'real-notes-read-only',status:result.status,readAt:result.readAt,page:result.page,pages:result.pages,sourcePresent:Boolean(result.source?.noteId),contentChars:result.content?.length??0,notesWrites:0,modelCalls:0,feishuCalls:0,durationMs:Math.round(performance.now()-started)}));
  if(result.status!=='okr_query') process.exitCode=1;
} catch(error) {console.error(JSON.stringify({status:'stopped',code:/^[A-Z_]+$/u.test(error.message)?error.message:'VERIFICATION_FAILED'}));process.exitCode=1;}
finally {db?.close();}
