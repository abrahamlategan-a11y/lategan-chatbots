const $=id=>document.getElementById(id);
const year=Number(new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Perth",year:"numeric"}).format(new Date()));
const params=new URLSearchParams(location.search);
const studentView=params.get("view")==="student";
const studentDemo=studentView&&params.get("demo")==="1";
let demoRevealed=false;
let demoMode=false,busy=false,state,identity,visible=false,timer,pendingIds=[],studentGeneration=0;
let teacherCode=localStorage.getItem("lategan_teacher_code")||"";
let studentCode=localStorage.getItem("lategan_student_code")||"";
const demoState={classes:[{id:1,name:"4L"},{id:2,name:"4A"}],students:[{id:1,display_name:"Alex",class_id:1},{id:2,display_name:"Blair",class_id:2},{id:3,display_name:"Casey",class_id:1},{id:4,display_name:"Morgan",class_id:2}],revision:-1,state:{drawn:false,participants:[],pairs:[]}};
async function api(action,data={}){
 if(studentDemo){
  if(action==="identity"){
   if(!["alex","blair"].includes(data.student_code.toLowerCase()))throw Error("Demo codes are ALEX and BLAIR.");
   return {student:{id:data.student_code.toLowerCase()==="alex"?1:2,display_name:data.student_code.toLowerCase()==="alex"?"Alex":"Blair",class_name:data.student_code.toLowerCase()==="alex"?"4L":"4A"}};
  }
  if(action==="password_reveal"){if(data.reveal_password!=="482715")throw Error("That Secret Santa password is incorrect.");const first_reveal=!demoRevealed;demoRevealed=true;return {recipient:{name:"Casey",class_name:"4A"},first_reveal}}
 }
 const response=await fetch("https://lategan-chatbot.abrahamlategan.workers.dev",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"lh_assessment_santa_"+action,year,...data})});
 const result=await response.json();
 if(!response.ok||result.error)throw Error(result.error||"Could not connect.");
 return result;
}
const teacherApi=(action,data={})=>api("teacher_"+action,{teacher_code:teacherCode,...data});
function node(tag,text){const element=document.createElement(tag);if(text)element.textContent=text;return element}
function lock(value){busy=value;$("teacherTools").querySelectorAll("button,input").forEach(control=>control.disabled=value)}
function selected(){return [...$("roster").querySelectorAll("input[data-student]:checked")].map(input=>Number(input.value))}
function updateCount(){$("count").textContent=selected().length+" students included."}
function drawRoster(){
 $("roster").replaceChildren();
 for(const c of state.classes){
  const field=node("fieldset"),legend=node("legend"),classCheck=node("input"),names=node("div");
  names.className="names";classCheck.type="checkbox";classCheck.checked=true;classCheck.setAttribute("aria-label","Include "+c.name);
  legend.append(classCheck,document.createTextNode(" "+c.name));field.append(legend,names);
  for(const student of state.students.filter(s=>s.class_id===c.id)){
   const label=node("label"),input=node("input");input.type="checkbox";input.checked=true;input.value=student.id;input.dataset.student="true";
   input.onchange=()=>{classCheck.checked=[...names.querySelectorAll("input")].every(i=>i.checked);classCheck.indeterminate=!classCheck.checked&&[...names.querySelectorAll("input")].some(i=>i.checked);updateCount()};
   label.append(input,document.createTextNode(" "+student.display_name));names.append(label);
  }
  classCheck.onchange=()=>{names.querySelectorAll("input").forEach(i=>i.checked=classCheck.checked);classCheck.indeterminate=false;updateCount()};
  $("roster").append(field);
 }
 updateCount();
}
function drawRegister(){
 $("pairs").replaceChildren();
 for(const person of [...state.state.participants].sort((a,b)=>a.name.localeCompare(b.name))){
  const pair=state.state.pairs.find(p=>p.giver===person.id),recipient=state.state.participants.find(s=>s.id===pair.recipient);
  const row=node("tr");
  for(const text of [person.name+" · "+person.class_name,recipient.name+" · "+recipient.class_name]){const td=node("td",text);row.append(td)}
  const td=node("td"),remove=node("button","Remove");remove.onclick=()=>removeStudent(person);td.append(remove);
  const hasPassword=state.password_student_ids?.includes(person.id);
  const issue=node("button",hasPassword?"Reset password":"Issue password");
  issue.onclick=()=>issuePassword(person,hasPassword);
  td.prepend(issue);row.append(td);$("pairs").append(row);
 }
 $("registerNote").textContent="Removing a student changes the recipient of their giver. Tell that student personally if they have already seen their name.";
}
async function issuePassword(person,hasPassword){
 if(busy)return;
 if(hasPassword&&!confirm("Replace the Secret Santa password for "+person.name+"?"))return;
 lock(true);
 try{
  const {password}=demoMode?{password:"482715"}:await teacherApi("password",{student_id:person.id});
  if(!password)throw Error("The updated Worker must be deployed first.");
  const ids=state.password_student_ids??=[];
  if(!ids.includes(person.id))ids.push(person.id);
  prompt("Share this privately with "+person.name+". It is shown only now.",password);
  render();
 }catch(error){$("status").textContent=error.message}
 finally{lock(false)}
}
function render(){
 $("setup").hidden=state.state.drawn;$("register").hidden=!state.state.drawn;
 if(state.state.drawn)drawRegister();else drawRoster();
 $("status").textContent=demoMode?"Fictional demo. The real draw is not affected.":"";
 $("demo").textContent=demoMode?"Exit fictional demo":"Try fictional demo";
}
async function load(){
 if(busy)return;lock(true);
 try{
  state=await teacherApi("get");$("teacherLogin").hidden=true;$("teacherTools").hidden=false;render();
 }catch(error){$("teacherLogin").hidden=false;$("teacherTools").hidden=false;$("setup").hidden=$("register").hidden=true;$("status").textContent=error.message}
 finally{lock(false)}
}
$("teacherLogin").onsubmit=event=>{event.preventDefault();teacherCode=$("teacherCode").value.trim();void load()};
$("refresh").onclick=()=>{if(demoMode){render();return}void load()};
$("demo").onclick=()=>{
 if(busy)return;
 demoMode=!demoMode;
 if(demoMode){state=structuredClone(demoState);render()}else void load();
};
$("draw").onclick=()=>{
 pendingIds=selected();
 if(pendingIds.length<3){$("status").textContent="Select at least three students.";return}
 $("drawSummary").textContent=pendingIds.length+" students will take part"+(demoMode?" in this fictional demo.":".");
 $("confirmDraw").showModal();
};
$("cancelDraw").onclick=()=>$("confirmDraw").close();
$("makeDraw").onclick=async()=>{
 if(busy)return;
 $("confirmDraw").close();lock(true);
 try{
  if(demoMode){
   const ids=[...pendingIds].sort(()=>Math.random()-.5);
   state.state={drawn:true,participants:ids.map(id=>{const s=state.students.find(s=>s.id===id);return {id,name:s.display_name,class_name:state.classes.find(c=>c.id===s.class_id).name}}),pairs:ids.map((giver,i)=>({giver,recipient:ids[(i+1)%ids.length]}))};
  }else{await teacherApi("draw",{revision:state.revision,student_ids:pendingIds});state=await teacherApi("get")}
  render();
 }catch(error){$("status").textContent=error.message}finally{lock(false)}
};
async function removeStudent(person){
 const incoming=state.state.pairs.find(p=>p.recipient===person.id);
 const giver=state.state.participants.find(s=>s.id===incoming.giver);
 if(!confirm("Remove "+person.name+"? "+giver.name+" will get a different recipient. Please notify them if they have already revealed."))return;
 lock(true);
 try{
  if(demoMode){
   if(state.state.participants.length<=3)throw Error("At least three participants are needed.");
   const next=state.state.pairs.find(p=>p.giver===person.id).recipient;
   state.state.pairs=state.state.pairs.filter(p=>p.giver!==person.id).map(p=>p.giver===giver.id?{...p,recipient:next}:p);
   state.state.participants=state.state.participants.filter(p=>p.id!==person.id);
  }else{await teacherApi("remove",{revision:state.revision,student_id:person.id});state=await teacherApi("get")}
  render();
 }catch(error){$("status").textContent=error.message}finally{lock(false)}
}
$("csv").onclick=()=>{
 const rows=[["Student","Class","Buying for","Recipient class"],...state.state.pairs.map(pair=>{
  const a=state.state.participants.find(p=>p.id===pair.giver),b=state.state.participants.find(p=>p.id===pair.recipient);return [a.name,a.class_name,b.name,b.class_name];
 })];
 const cell=value=>{let s=String(value??"");if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};
 const url=URL.createObjectURL(new Blob(["\uFEFF"+rows.map(row=>row.map(cell).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}));
 const a=node("a");a.href=url;a.download="year-4-secret-santa-"+year+".csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const revealPassword=node("input");
revealPassword.type="password";
revealPassword.autocomplete="off";
revealPassword.maxLength=16;
revealPassword.style.cssText="width:100%;padding:12px;border:1px solid #aaa07866;border-radius:10px";
const passwordLabel=node("label","Secret Santa PIN");
passwordLabel.append(revealPassword);
$("reveal").before(passwordLabel);
$("revealPanel").querySelectorAll("p")[1].textContent="Enter your PIN and tap the card. The name hides after five seconds.";
revealPassword.onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();$("reveal").click()}};
function hide(){
 revealPassword.value="";revealPassword.disabled=false;
 clearTimeout(timer);visible=false;$("recipient").textContent="Secret recipient";$("recipient").classList.add("blur");$("recipient").setAttribute("aria-hidden","true");$("reveal").setAttribute("aria-label","Reveal your recipient");
}
function switchStudent(){
 studentGeneration++;hide();identity=null;studentCode="";if(!studentDemo)localStorage.removeItem("lategan_student_code");
 $("account").textContent="";$("check").hidden=$("revealPanel").hidden=true;$("studentLogin").hidden=false;$("studentCode").value="";$("studentStatus").textContent="";$("studentCode").focus();
}
async function identify(){
 const generation=++studentGeneration;hide();$("check").hidden=$("revealPanel").hidden=true;
 try{
  const result=await api("identity",{student_code:studentCode});
  if(generation!==studentGeneration)return;
  identity=result.student;$("identity").textContent=identity.display_name+" · "+identity.class_name;$("account").textContent=$("identity").textContent;
  $("studentLogin").hidden=true;$("check").hidden=false;$("studentStatus").textContent="";
  if(!studentDemo)localStorage.setItem("lategan_student_code",studentCode);
 }catch(error){if(generation!==studentGeneration)return;$("studentLogin").hidden=false;$("studentStatus").textContent=error.message}
}
$("studentLogin").onsubmit=event=>{event.preventDefault();studentCode=$("studentCode").value.trim();void identify()};
$("wrong").onclick=$("switch").onclick=switchStudent;
$("confirm").onclick=()=>{$("check").hidden=true;$("revealPanel").hidden=false;hide()};
function fireworks(){
 if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
 const layer=document.querySelector(".effects");
 for(const [x,y] of [[20,35],[78,46],[50,70]])for(let i=0;i<30;i++){
  const spark=node("span");spark.className="spark";spark.style.left=x+"%";spark.style.top=y+"%";
  const angle=i/30*Math.PI*2,r=70+Math.random()*60;spark.style.setProperty("--dx",Math.cos(angle)*r+"px");spark.style.setProperty("--dy",Math.sin(angle)*r+30+"px");spark.style.setProperty("--color",["#ffe19b","#f58e9c","#9de2cb"][i%3]);layer.append(spark);setTimeout(()=>spark.remove(),1200);
 }
}
$("reveal").onclick=async()=>{
 if(visible){hide();return}
 const password=revealPassword.value.trim().toLowerCase();
 if(!/^(?:[0-9]{6}|[a-f0-9]{16})$/.test(password)){
  $("studentStatus").textContent="Enter the six-digit Secret Santa PIN from your teacher.";
  revealPassword.focus();
  return;
 }
 $("studentStatus").textContent="";
 revealPassword.value="";
 revealPassword.disabled=true;
 const generation=studentGeneration,button=$("reveal");button.disabled=true;
 try{
  const result=await api("password_reveal",{student_code:studentCode,confirmed_student_id:identity.id,reveal_password:password});
  if(generation!==studentGeneration||document.hidden)return;
  visible=true;$("recipient").textContent=result.recipient.name+" · "+result.recipient.class_name;$("recipient").classList.remove("blur");$("recipient").removeAttribute("aria-hidden");button.setAttribute("aria-label","Hide your recipient");
  if(result.first_reveal)fireworks();
  timer=setTimeout(hide,5000);
 }catch(error){if(generation===studentGeneration)$("studentStatus").textContent=error.message}
 finally{button.disabled=false;revealPassword.disabled=visible}
};
document.addEventListener("visibilitychange",()=>{if(document.hidden){studentGeneration++;hide()}});
window.addEventListener("blur",hide);
$("teacher").hidden=studentView;$("student").hidden=!studentView;
if(studentDemo){
 studentCode="alex";
 $("home").textContent="← Secret Santa setup";$("home").href="./";
 const note=node("p","Fictional preview · PIN 482715 · use ALEX or BLAIR to switch students.");
 $("student").before(note);
}
if(studentView){if(!studentDemo)$("home").href="../student/";if(studentCode)void identify();else switchStudent()}
else if(teacherCode)void load();else $("teacherLogin").hidden=false;
