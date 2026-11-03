import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = p => readFileSync(new URL('../../'+p, import.meta.url),'utf8');
const block = read('maths-trek/worker-actions.js.txt');
const metadata = JSON.parse(read('assessments/question-metadata.json'));
const context = vm.createContext({});
vm.runInContext(read('assessments/reporting.js'),context);
const summary = (r) => context.mathsTrekSummary(r,metadata);
const full = Array.from({length:40},(_,i)=>i<24?1:i<36?2:3);
assert.equal(metadata.length,4);assert.ok(metadata.every(t=>t.length===40));
for(let test=1;test<=4;test++){
  const d=summary([{test,marks:full}]);
  assert.equal(d.total,60);assert.equal(d.available,60);
  assert.deepEqual(Array.from(d.parts,x=>x.score),[24,24,12]);
  assert.equal(Object.values(d.strands).reduce((a,x)=>a+x.max,0),60);
  assert.equal(d.growth.length,0);
}
assert.equal(summary([]).available,0);
assert.equal(summary([{test:1,marks:Array(40).fill(0)}]).total,0);
const mixed=summary([{test:1,marks:full},{test:2,marks:Array(40).fill(0)}]);
assert.equal(mixed.total,60);assert.equal(mixed.available,120);
assert.ok(!mixed.strengths.some(a=>mixed.growth.some(b=>a.name===b.name)));
assert.equal(context.mathsTrekCsvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');
// Compile inline UI code independently of the DOM.
const html=read('assessments/index.html');
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE students(id INTEGER PRIMARY KEY,teacher_id INTEGER,class_id INTEGER,active INTEGER,display_name TEXT,class_name TEXT);
CREATE TABLE teacher_classes(teacher_id INTEGER,class_id INTEGER);
INSERT INTO teacher_classes VALUES(1,10),(2,20);
INSERT INTO students VALUES(101,1,10,1,'One','A'),(102,2,20,1,'Two','B'),(103,1,10,0,'Inactive','A'),(104,1,30,1,'Removed class','C');`);
db.exec(read('maths-trek/migrations/001_create_tables.sql'));
db.exec(read('maths-trek/migrations/001_create_tables.sql')); // repeatable migration
let failMemberInsert=false;
function prepare(sql){let params=[];const statement={bind(...args){params=args;return statement},
 async first(){return db.prepare(sql).get(...params)||null},
 async all(){return {results:db.prepare(sql).all(...params)}},
 async run(){if(failMemberInsert&&sql.startsWith('INSERT INTO maths_trek_group_students'))throw Error('Injected failure');return {meta:db.prepare(sql).run(...params)}}};return statement}
const env={DB:{prepare,async batch(statements){db.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}}};
const handle=new Function('getTeacher','return async function(body,env){const action=body.action;const json=(data,status=200)=>({data,status});'+block+'}')
 (async(_env,code)=>code==='one'?{id:1}:code==='two'?{id:2}:null);
const call=(action,body={},teacher_code='one')=>handle({action,teacher_code,...body},env);
assert.equal((await call('maths_trek_list',{},'bad')).status,401);
for(const student_id of [102,103,104])assert.equal((await call('maths_trek_save',{student_id,test_number:1,marks:full})).status,403);
for(const marks of [[],Array(40).fill(4),Array(40).fill(.5),Array(40).fill('1')])assert.equal((await call('maths_trek_save',{student_id:101,test_number:1,marks})).status,400);
assert.equal((await call('maths_trek_save',{student_id:101,test_number:5,marks:full})).status,400);
assert.equal((await call('maths_trek_save',{student_id:101,test_number:1,marks:full})).data.total,60);
assert.equal((await call('maths_trek_save',{student_id:101,test_number:1,marks:Array(40).fill(0)})).data.total,0);
assert.equal((await call('maths_trek_list')).data.results.length,1);
assert.equal((await call('maths_trek_list',{},'two')).data.results.length,0);
db.exec('DELETE FROM teacher_classes WHERE teacher_id=1');
assert.equal((await call('maths_trek_list')).data.results.length,0);
db.exec('INSERT INTO teacher_classes VALUES(1,10)');
assert.equal((await call('maths_trek_groups_save',{name:'Invalid',student_ids:[102]})).status,403);
const group=(await call('maths_trek_groups_save',{name:'Group',student_ids:[101,101]})).data.group_id;
assert.equal((await call('maths_trek_groups_list')).data.groups[0].ids.length,1);
assert.equal((await call('maths_trek_groups_delete',{group_id:group},'two')).status,404);
failMemberInsert=true;
await assert.rejects(call('maths_trek_groups_save',{group_id:group,name:'Changed',student_ids:[101]}));
failMemberInsert=false;
assert.equal((await call('maths_trek_groups_list')).data.groups[0].name,'Group');
assert.equal((await call('maths_trek_groups_list')).data.groups[0].ids.length,1);
await call('maths_trek_groups_delete',{group_id:group});
assert.equal((await call('maths_trek_groups_list')).data.groups.length,0);

// Optional verified live reference: ensure additive insertion preserves every original byte of code.
if(process.argv[2]){
 const source=readFileSync(process.argv[2],'utf8').replace(/\r\n?/g,'\n');
 assert.equal(createHash('sha256').update(source).digest('hex'),'76c292c8917357543df63428e2effda4ace4311a5977b0dde6cc6d051f45a1bd');
 const marker='// ================= TEACHER =================';
 assert.equal(source.split(marker).length,2);
 const patched=source.replace(marker,block+'\n'+marker);
 assert.equal(patched.replace(block+'\n',''),source);
 const temp=mkdtempSync(join(tmpdir(),'maths-trek-test-'));
 try{
  const path=join(temp,'worker.mjs');writeFileSync(path,patched);
  const worker=(await import(path)).default;
  assert.equal((await worker.fetch(new Request('https://test/'),{})).status,200);
  assert.equal((await worker.fetch(new Request('https://test/',{method:'OPTIONS'}),{})).status,200);
  assert.equal((await worker.fetch(new Request('https://test/',{method:'DELETE'}),{})).status,405);
 }finally{rmSync(temp,{recursive:true,force:true})}
}
console.log('PASS: scoring, reports, CSV safety, UI syntax, access isolation, mark validation, upserts, atomic groups, additive Worker integrity and HTTP smoke checks.');
