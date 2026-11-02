// Run on an actual Windows runner against extracted published/candidate installers.
// All data is synthetic and isolated. No developer data or credentials are used.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {readPackagedState} from './package-state.mjs';
assert.equal(process.platform,'win32');
const [oldRoot,newRoot,version]=process.argv.slice(2).map((v,i)=>i<2?resolve(v):v);
assert.match(version,/^\d+\.\d+\.\d+$/);
const work=mkdtempSync(join(tmpdir(),'super-storage-native-')),dir=join(work,'data'),children=new Set();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const exe=root=>join(root,'Super Beta.exe'),resources=root=>join(root,'resources');
const env={...process.env,ELECTRON_RUN_AS_NODE:'1',SUPER_IN_APP:'1',SUPER_EDITION:'beta',HOME:work,SUPER_APP_HOME:work,SUPER_DEV_DATA:'',SUPER_DEV_PORT:'',SUPER_POSTHOG_HOST:'http://127.0.0.1:1'};
function start(root,v){const p=spawn(exe(root),[join(resources(root),'service/service.cjs')],{env:{...env,SUPER_APP_DATA_DIR:dir,SUPER_APP_RES:resources(root),SUPER_APP_VERSION:v},stdio:['ignore','pipe','pipe']});p.output='';p.stdout.on('data',d=>p.output+=d);p.stderr.on('data',d=>p.output+=d);children.add(p);return p;}
async function ready(p){for(const until=Date.now()+120000;Date.now()<until;await sleep(100)){if(p.exitCode!==null||p.signalCode)throw Error('Packaged service exited '+p.output.slice(-1200));try{const info=JSON.parse(readFileSync(join(dir,'service.json')));if(info.pid===p.pid&&(await fetch(info.url+'/v1/health')).ok)return info;}catch{}}throw Error('Packaged service timeout');}
async function stop(p){if(p.exitCode!==null||p.signalCode)return;const exit=new Promise(r=>p.once('exit',r));p.kill();await Promise.race([exit,sleep(10000)]);if(p.exitCode===null&&!p.signalCode)p.kill('SIGKILL');}
async function api(info,method,path,body,binary=false){const headers={authorization:'Bearer '+readFileSync(join(dir,'token'),'utf8').trim()};if(body!==undefined)headers['content-type']=binary?'application/octet-stream':'application/json';const r=await fetch(info.url+path,{method,headers,...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});if(!r.ok)throw Error(method+' '+path+' '+r.status+' '+(await r.text()).slice(0,300));return r.headers.get('content-type')?.includes('json')?r.json():Buffer.from(await r.arrayBuffer());}
async function act(info,name,actorId,targets,params){const r=await api(info,'POST','/v1/actions',{name,actorId,targets,params});assert.equal(r.ok,true,r.message);return r;}
const read=root=>readPackagedState(exe(root),resources(root),dir,env);
try{
 let p=start(oldRoot,'0.6.2'),info=await ready(p),s=await api(info,'GET','/v1/snapshot');const actor=s.company.ownerId,parent=s.company.companyLineId;
 await act(info,'开始用',actor,[actor],{name:'验证用户',locale:'zh',timezone:'Asia/Shanghai',usageConsent:false});
 const made=await act(info,'立任务',actor,[parent],{name:'保留原任务',parentId:parent,endpoint:'保留全部原文',deadline:'2026-12-31',noPeriod:true});const id=made.created[0];assert.ok(id);
 await act(info,'写事实',actor,[id],{title:'原始记录',body:'保留原文、空格  和换行\n第二行'});
 const bytes=Buffer.from('保留原文件\r\n第二行\n');await api(info,'PUT','/v1/files/content?path='+encodeURIComponent('升级核验.txt'),bytes,true);await act(info,'挂文件',actor,[id],{title:'升级核验.txt',path:'升级核验.txt'});await stop(p);
 const before=read(oldRoot),oldJournal=readFileSync(join(dir,'actions.jsonl'));
 p=start(newRoot,version);info=await ready(p);assert.equal(info.version,version);const after=read(newRoot);
 for(const [key,value]of Object.entries(before)){
  if(key==='now'){assert.ok(Number.isFinite(Date.parse(after.now)));continue;}
  if(key==='seq'){assert.ok(after.seq>=value);continue;}
  if(Array.isArray(value)){assert.deepEqual(after[key]?.slice(0,value.length),value,key);continue;}
  if(value&&typeof value==='object'){for(const [id,item]of Object.entries(value))assert.deepEqual(after[key]?.[id],item,key+'.'+id);continue;}
  assert.deepEqual(after[key],value,key);
 }
 assert.deepEqual(await api(info,'GET','/v1/files/raw/'+encodeURIComponent('升级核验.txt')),bytes);
 assert.deepEqual(readFileSync(join(dir,'actions.jsonl')).subarray(0,oldJournal.length),oldJournal);
 assert.ok(readdirSync(join(work,'data 备份')).some(n=>n.startsWith('自动迁移前-')));
 const added=await Promise.all(Array.from({length:8},(_,i)=>act(info,'立任务',actor,[parent],{name:'并行保存'+i,parentId:parent,endpoint:'结果'+i,deadline:'2026-12-31',noPeriod:true})));assert.equal(new Set(added.flatMap(r=>r.created)).size,8);
 await stop(p);const saved=read(newRoot);p=start(newRoot,version);info=await ready(p);const reopened=read(newRoot);for(const r of added)for(const id of r.created)assert.deepEqual(reopened.works[id],saved.works[id]);assert.deepEqual(reopened.workModel,saved.workModel);await stop(p);
 const denied=start(oldRoot,'0.6.2');await assert.rejects(()=>ready(denied));await stop(denied);assert.deepEqual(read(newRoot),reopened);
 writeFileSync(join(work,'report.json'),JSON.stringify({platform:process.platform,arch:process.arch,from:'0.6.2',to:version,actualPackagedServices:true,oldDataPreserved:true,automaticBackup:true,fileBytesPreserved:true,originalJournalPrefixPreserved:true,parallelWritesPreserved:true,restartPreserved:true,oldVersionRefused:true,syntheticDataOnly:true},null,2));console.log(JSON.stringify({ok:true,report:join(work,'report.json')}));
}finally{for(const p of children)await stop(p);}
