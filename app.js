'use strict';
/* Habit & Task Tracker — vanilla JS, localStorage. See README for structure. */
const $=s=>document.querySelector(s),uid=()=>Math.random().toString(36).slice(2,10);
const D=d=>{d=d||new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const P=s=>{const[y,m,d]=s.split('-');return new Date(+y,m-1,+d)};
const add=(s,n)=>{const d=P(s);d.setDate(d.getDate()+n);return D(d)};
const wk=s=>add(s,-((P(s).getDay()+6)%7)),dow=s=>(P(s).getDay()+6)%7;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const WD=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],PR={High:0,Medium:1,Low:2};
const hm=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h?`${h}h ${m}m`:`${m}m`};
const clock=s=>{s=Math.floor(s);return[Math.floor(s/3600),Math.floor(s%3600/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':')};
const safeUrl=u=>/^https?:\/\//i.test(u||'');
let S=JSON.parse(localStorage.getItem('ht1')||'null')||{habits:[],checkins:[],tasks:[],sessions:[],rewards:[],timer:null,theme:'system',audit:[]};
const save=()=>localStorage.setItem('ht1',JSON.stringify(S));
const log=(type,id,p)=>S.audit.push({type,id,p,at:Date.now()});
let tab='today',view=null,q='',fil='open';
const today=()=>D();

/* ---------- Habit engine ---------- */
const req=h=>h.type==='daily'?1:h.type==='weekly'?h.n:h.days.length;
const hDays=h=>new Set(S.checkins.filter(c=>c.h===h.id).map(c=>c.d));
function period(h,d){return h.type==='daily'?[d,d]:[wk(d),add(wk(d),6)]}
function done(h,[a,b],set=hDays(h)){let n=0;for(let d=a;d<=b;d=add(d,1))if(set.has(d)&&(h.type!=='days'||h.days.includes(dow(d))))n++;return n}
function status(h){
  const t=today(),p=period(h,t),n=done(h,p),r=req(h);
  if(h.type==='daily')return n?'On track':'Due today';
  const left=7-dow(t);if(n>=r)return 'On track';
  return r-n>=left?'At risk':'On track'}
function unlock(h,src){const r=h.ms.reward;S.rewards.push({id:uid(),name:r||'Milestone reached',url:h.ms.url,src,status:'unlocked',at:Date.now()});log('reward_unlocked',h.id,{r})}
function checkMs(h){
  if(h.prog>=h.ms.target){h.attempts.push({s:h.attemptStart,e:today(),state:'Completed',prog:h.prog});h.completed++;
    unlock(h,h.name);h.prog=0;h.attemptStart=today();log('milestone_completed',h.id);celebrate('🎉 Milestone reached! Reward unlocked.')}}
function bump(h,d){h.prog=Math.max(0,h.prog+d);if(d>0)h.best=Math.max(h.best,h.prog);checkMs(h)}
function checkin(h){
  const t=today(),set=hDays(h);if(set.has(t)&&!h.multi)return;
  const id=uid();S.checkins.push({id,h:h.id,d:t,at:Date.now(),tz:Intl.DateTimeFormat().resolvedOptions().timeZone});
  log('checkin',h.id);
  if(h.ms.kind==='count'||(h.ms.kind==='streak'&&h.type==='daily'&&!set.has(t)))bump(h,1);
  save();render();toast('Checked in',()=>{S.checkins=S.checkins.filter(c=>c.id!==id);if(h.prog>0&&(h.ms.kind==='count'||h.type==='daily'))h.prog--;save();render()})}
function evaluate(){
  const t=today();
  S.habits.forEach(h=>{if(h.archived)return;
    let p=h.evalFrom;const set=hDays(h);
    while(period(h,p)[1]<t){
      const[a,b]=period(h,p);
      if(h.type==='daily'||a>=wk(h.start)){
        const n=done(h,[a,b],set),r=req(h),ok=n>=r;
        h.evals.push({a,b,r,n,ok});log(ok?'period_met':'period_missed',h.id,{a,n,r});
        if(ok){if(h.ms.kind==='streak'&&h.type!=='daily')bump(h,1)}
        else if(h.ms.policy==='reset')reset(h,a);else if(h.ms.policy==='ask')h.ask=a}
      p=add(b,1)}
    h.evalFrom=p});
  save()}
function reset(h,why){if(h.prog>0||true){h.attempts.push({s:h.attemptStart,e:today(),state:'Reset',prog:h.prog});h.resets++;h.prog=0;h.attemptStart=today();h.ask=null;log('milestone_reset',h.id,{why})}}

/* ---------- Task engine ---------- */
const overdue=k=>k.due&&!['Completed','Cancelled','Archived'].includes(k.status)&&(k.due<today()||(k.due===today()&&k.time&&k.time<new Date().toTimeString().slice(0,5)&&false));
const el=k=>S.timer&&S.timer.id===k.id?(S.timer.acc+(S.timer.run?(Date.now()-S.timer.at)/1000:0)):0;
const worked=k=>S.sessions.filter(s=>s.t===k.id).reduce((a,s)=>a+s.dur,0);
function addSession(k,dur,type,note,start){
  S.sessions.push({id:uid(),t:k.id,start:start||Date.now()-dur*1000,dur,type,note});log(type==='timer'?'timer_stopped':'session_added',k.id,{dur});
  if(k.status==='Not Started')k.status='In Progress';k.last=Date.now();
  if(k.ms.mode==='worklog'){const ev=k.ms.every*3600;k.mp+=dur;
    if(k.ms.after==='add'){while(k.mp>=ev*(k.fired+1)){k.fired++;unlockT(k)}}
    else while(k.mp>=ev){k.mp-=ev;unlockT(k)}}}
function unlockT(k){S.rewards.push({id:uid(),name:k.ms.reward||'Work milestone',url:k.ms.url,src:k.title,status:'unlocked',at:Date.now()});log('reward_unlocked',k.id);celebrate('🎉 Work milestone reached!')}
function complete(k){
  k.status='Completed';k.doneAt=Date.now();log('task_completed',k.id);
  if(S.timer&&S.timer.id===k.id)stopTimer();
  if(k.ms.mode==='once'&&k.ms.reward&&!k.once){k.once=1;unlockT(k)}
  save();render();toast('Task completed',()=>{k.status='In Progress';log('task_reopened',k.id);save();render()})}
function stopTimer(){if(!S.timer)return;const k=S.tasks.find(x=>x.id===S.timer.id),d=el(k);S.timer=null;if(d>=1)addSession(k,d,'timer')}
function startTimer(k){
  if(S.timer&&S.timer.id!==k.id){if(!confirm('Another timer is running. Stop it and start this one?'))return;stopTimer()}
  S.timer={id:k.id,run:true,at:Date.now(),acc:0};if(k.status==='Not Started')k.status='In Progress';log('timer_started',k.id);save();render()}

/* ---------- UI helpers ---------- */
let tt;function toast(m,undo){const t=$('#toast');t.hidden=false;t.innerHTML=`<span>${esc(m)}</span>${undo?'<button id=undo>Undo</button>':''}`;
  if(undo)$('#undo').onclick=()=>{undo();t.hidden=true};clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,5000)}
const celebrate=m=>toast(m);
function ring(n,r,c='var(--ac)'){const f=r?Math.min(1,n/r):0,L=2*Math.PI*26;
  return `<div class=ring role=img aria-label="${n} of ${r}"><svg width=64 height=64><circle cx=32 cy=32 r=26 fill=none stroke="var(--tr)" stroke-width=6 /><circle cx=32 cy=32 r=26 fill=none stroke="${c}" stroke-width=6 stroke-linecap=round stroke-dasharray="${L*f} ${L}"/></svg><b>${n}/${r}</b></div>`}
const bar=(n,r)=>`<div class=bar role=progressbar aria-valuenow=${n} aria-valuemax=${r}><i style="width:${r?Math.min(100,n/r*100):0}%"></i></div>`;
const sched=h=>h.type==='daily'?'Daily':h.type==='weekly'?`${h.n} days / week`:h.days.map(i=>WD[i]).join(', ');
const unit=h=>h.ms.kind==='streak'?(h.type==='daily'?'days':'periods'):'sessions';
function habitCard(h){
  const t=today(),p=period(h,t),n=done(h,p),r=req(h),dn=hDays(h).has(t),sch=h.type!=='days'||h.days.includes(dow(t));
  const off=!sch||(dn&&!h.multi);
  return `<div class="card"><div class="row">${ring(n,r)}<div class=grow><b data-a=hd data-id=${h.id} style="cursor:pointer">${esc(h.icon||'')} ${esc(h.name)}</b><div class=mu>${sched(h)} · ${status(h)}</div>
  <div class=mu style="margin-top:4px">${h.ms.kind==='streak'?'Streak':'Landmark'} <b class=am>${h.prog} / ${h.ms.target}</b> ${unit(h)}</div>${bar(h.prog,h.ms.target)}</div>
  <button class="chk ${dn?'done':''}" data-a=ci data-id=${h.id} ${off&&!(dn&&!h.multi)?'disabled':''} aria-label="${dn?'Undo check-in':'Check in'} ${esc(h.name)}" ${dn&&!h.multi?'':''}>${dn?'✓':''}</button></div></div>`}
function taskRow(k){
  const od=overdue(k),run=S.timer&&S.timer.id===k.id,dm=k.due===today()?'Due today':k.due?(od?'Overdue since '+(k.due===add(today(),-1)?'yesterday':k.due):'Due '+k.due):'No deadline';
  return `<div class=row style="padding:8px 0"><button class="chk ${k.status==='Completed'?'done':''}" data-a=tc data-id=${k.id} aria-label="Complete ${esc(k.title)}">${k.status==='Completed'?'✓':''}</button>
  <div class=grow data-a=td data-id=${k.id} style="cursor:pointer"><div>${esc(k.title)}</div><div class="mu ${od?'dg':''}">${k.pri} · ${dm}${k.time?' '+k.time:''}${od?' ⚠':''}</div></div>${run?`<span class="pill ok" data-tick=${k.id}>${clock(el(k))}</span>`:''}</div>`}

/* ---------- Views ---------- */
function vToday(){
  const t=today(),act=S.habits.filter(h=>!h.archived&&(h.type!=='days'||h.days.includes(dow(t))||h.type==='days'));
  const sched=act.filter(h=>h.type!=='days'||h.days.includes(dow(t))),nd=sched.filter(h=>hDays(h).has(t)).length;
  const open=S.tasks.filter(k=>!['Completed','Cancelled','Archived'].includes(k.status)),run=k=>S.timer&&S.timer.id===k.id;
  const dueL=open.filter(k=>k.due&&k.due<=t||run(k)&&k.due).sort((a,b)=>(a.due<b.due?-1:a.due>b.due?1:(a.time||'99')<(b.time||'99')?-1:PR[a.pri]-PR[b.pri]));
  const any=open.filter(k=>!k.due&&(run(k)||k.status==='In Progress'||k.start<=t)).sort((a,b)=>PR[a.pri]-PR[b.pri]||(b.last||0)-(a.last||0));
  const anyShow=any.filter(run).concat(any.filter(k=>!run(k)).slice(0,3));
  const dn=S.tasks.filter(k=>k.status==='Completed'&&D(new Date(k.doneAt))===t).length;
  const asks=S.habits.filter(h=>h.ask);
  return `<div class="row sp"><h1>${new Date().toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short'})}</h1><button class=ic data-a=set aria-label=Settings>⚙</button></div>
  ${asks.map(h=>`<div class=card><b>${esc(h.name)}</b> missed its period. Reset milestone progress?<div class=row style="margin-top:10px"><button class="btn sm" data-a=rs data-id=${h.id}>Reset</button><button class="btn sm out" data-a=keep data-id=${h.id}>Keep progress</button></div></div>`).join('')}
  <div class=lbl>Habits · ${nd} of ${sched.length} done today</div>
  ${sched.map(habitCard).join('')||'<div class="card mu">No habits scheduled today. <a href=# data-a=nh>Add a habit</a></div>'}
  <div class=lbl>Tasks · ${dueL.filter(k=>k.due===t).length} due today, ${dueL.filter(overdue).length} overdue</div>
  <div class=card>${dueL.length+anyShow.length?'':'<div class=mu style="text-align:center;padding:10px">Nothing due today<br><br><button class="btn sm" data-a=nt>Add task</button></div>'}
  ${dueL.map(taskRow).join('')}${anyShow.length?`<div class=lbl>Anytime · no deadline</div>${anyShow.map(taskRow).join('')}<a href=# data-a=tab data-id=tasks>See all tasks</a>`:''}
  ${dn?`<div class=mu style="margin-top:8px">✓ Done today: ${dn}</div>`:''}</div>`}
function vHabits(){
  const l=S.habits.filter(h=>!h.archived&&h.name.toLowerCase().includes(q.toLowerCase())),ar=S.habits.filter(h=>h.archived);
  return `<div class="row sp"><h1>Habits</h1><button class=ic data-a=nh aria-label="New habit">+</button></div>
  <input type=text id=q placeholder="Search habits" value="${esc(q)}" aria-label="Search habits">
  <div class=lbl></div>${l.map(habitCard).join('')||'<p class=mu>No habits yet. Tap + to add one.</p>'}
  ${ar.length?`<div class=lbl>Archived</div>${ar.map(h=>`<div class="card row sp"><span>${esc(h.name)}</span><button class="btn sm out" data-a=unarch data-id=${h.id}>Restore</button></div>`).join('')}`:''}`}
function vTasks(){
  let l=S.tasks.filter(k=>k.title.toLowerCase().includes(q.toLowerCase()));
  l=l.filter(k=>fil==='open'?!['Completed','Cancelled','Archived'].includes(k.status):fil==='done'?k.status==='Completed':fil==='over'?overdue(k):true);
  l.sort((a,b)=>(a.due||'9')<(b.due||'9')?-1:PR[a.pri]-PR[b.pri]);
  const chips=[['open','Open'],['over','Overdue'],['done','Completed'],['all','All']].map(([v,n])=>`<label class=chip><input type=radio name=fil value=${v} ${fil===v?'checked':''}>${n}</label>`).join('');
  return `<div class="row sp"><h1>Tasks</h1><button class=ic data-a=nt aria-label="New task">+</button></div>
  <input type=text id=q placeholder="Search tasks" value="${esc(q)}" aria-label="Search tasks"><div style="margin:10px 0" id=fil>${chips}</div>
  <div class=card>${l.map(taskRow).join('')||'<span class=mu>No tasks here.</span>'}</div>`}
function vRewards(){
  const seg=view?.seg||'unlocked',R=S.rewards.filter(r=>r.status===seg);
  const up=S.habits.filter(h=>!h.archived&&h.ms.reward).map(h=>({n:h.ms.reward,src:h.name,p:h.prog/h.ms.target})).concat(S.tasks.filter(k=>k.ms.mode==='worklog'&&k.ms.reward&&k.status!=='Completed').map(k=>({n:k.ms.reward,src:k.title,p:k.mp/(k.ms.every*3600)})));
  const ready=S.rewards.filter(r=>r.status==='unlocked').length;
  const card=(n,s,a)=>`<div class="card row"><div class=ic style="display:grid;place-items:center;border-radius:14px">${esc(n[0]||'★')}</div><div class=grow><b>${esc(n)}</b><div class=mu>${esc(s)}</div></div>${a}</div>`;
  return `<h1>Rewards</h1><p class=mu>${ready} ready to claim</p><div class=seg role=radiogroup id=rseg>${['unlocked','upcoming','claimed'].map(s=>`<label><input type=radio name=rs value=${s} ${seg===s?'checked':''}>${s[0].toUpperCase()+s.slice(1)}</label>`).join('')}</div>
  ${seg==='upcoming'?up.map(u=>card(u.n,u.src,`<span class=am>${Math.round(u.p*100)}%</span>`)).join('')||'<p class=mu>Set a reward on a habit or task milestone.</p>':
  R.map(r=>card(r.name,'From '+r.src,(seg==='unlocked'?(safeUrl(r.url)?`<a class="btn sm out" style="display:grid;place-items:center" href="${esc(r.url)}" target=_blank rel=noopener>Open link</a>`:'')+`<button class="btn sm" data-a=claim data-id=${r.id}>Claim</button>`:'<span class=mu>✓</span>')).replace('class="card row"','class="card row" style="flex-wrap:wrap"')).join('')||'<p class=mu>Nothing here yet.</p>'}`}
function vStats(){
  const m=view?.m||'habits',H=S.habits,ev=H.flatMap(h=>h.evals),met=ev.filter(e=>e.ok).length;
  const tk=S.tasks,sec=S.sessions.reduce((a,s)=>a+s.dur,0),cats={};S.sessions.forEach(s=>{const k=tk.find(x=>x.id===s.t);if(k){const c=k.cat||'Other';cats[c]=(cats[c]||0)+s.dur}});
  const st=(n,l)=>`<div class=card style="flex:1;margin:0"><div class=num style="font-size:28px">${n}</div><div class=mu>${l}</div></div>`;
  const week=ev.slice(-12);
  return `<h1>Statistics</h1><div class=seg id=mseg>${['habits','tasks'].map(s=>`<label><input type=radio name=ms value=${s} ${m===s?'checked':''}>${s[0].toUpperCase()+s.slice(1)}</label>`).join('')}</div>
  ${m==='habits'?`<div class=row>${st(S.checkins.length,'Check-ins')}${st(Math.max(0,...H.map(h=>h.best)),'Longest streak')}</div><div class=row style="margin-top:12px">${st(ev.length?Math.round(met/ev.length*100)+'%':'–','Completion rate')}${st(H.reduce((a,h)=>a+h.completed,0),'Milestones')}</div><div class=row style="margin:12px 0">${st(H.reduce((a,h)=>a+h.resets,0),'Resets')}${st(ev.length-met,'Periods hindered')}</div>
  <div class=lbl>Periods met vs hindered</div><div class=card><div class=row style="gap:4px;align-items:flex-end;height:60px">${week.map(e=>`<span title="${e.a}" style="flex:1;height:${e.ok?100:35}%;background:${e.ok?'var(--ac)':'var(--dg)'};border-radius:4px"></span>`).join('')||'<span class=mu>No evaluated periods yet.</span>'}</div><div class=mu>Teal = met · Red = hindered</div></div>`
  :`<div class=row>${st(tk.length,'Total')}${st(tk.filter(k=>k.status==='Completed').length,'Completed')}</div><div class=row style="margin:12px 0">${st(tk.filter(k=>!['Completed','Cancelled','Archived'].includes(k.status)).length,'Open')}${st(tk.filter(overdue).length,'Overdue')}</div><div class=row>${st((sec/3600).toFixed(1)+'h','Total hours')}${st(S.sessions.length?hm(sec/S.sessions.length):'–','Avg session')}</div>
  <div class=lbl>Time by category</div><div class=card>${Object.entries(cats).map(([c,s])=>`<div class="row sp"><span>${esc(c)}</span><b>${hm(s)}</b></div>${bar(s,sec)}`).join('')||'<span class=mu>No time logged.</span>'}</div>`}`}
function render(){
  if(tab==='task'&&view?.task)return taskDetail(view.task);
  const v={today:vToday,habits:vHabits,tasks:vTasks,rewards:vRewards,stats:vStats}[tab];
  const fq=document.activeElement?.id==='q';$('#app').innerHTML=v();
  if(fq){const i=$('#q');i.focus();i.setSelectionRange(99,99)}
  const T=[['today','◉','Today'],['habits','↻','Habits'],['tasks','☑','Tasks'],['rewards','★','Rewards'],['stats','▥','Stats']];
  $('#tabs').innerHTML=T.map(([k,i,n])=>`<button data-a=tab data-id=${k} ${tab===k?'aria-current=page':''}><span aria-hidden=true>${i}</span>${n}</button>`).join('')}

/* ---------- Sheets / forms ---------- */
function sheet(h){const s=$('#sheet');s.hidden=!h;s.innerHTML=h?`<div role=dialog aria-modal=true>${h}</div>`:'';if(h)s.querySelector('input,button')?.focus()}
const seg=(n,o,v)=>`<div class=seg>${o.map(x=>`<label><input type=radio name=${n} value="${x}" ${x===v?'checked':''}>${x}</label>`).join('')}</div>`;
const fld=(l,i)=>`<label class=fld><span>${l}</span>${i}</label>`;
const val=n=>document.querySelector(`#sheet [name=${n}]:checked`)?.value??document.querySelector(`#sheet [name=${n}]`)?.value;
const CATS=['Health','Work','Learning','Home','Personal'];
function fHabit(){sheet(`<div class="row sp"><h2 class=num>New habit</h2><button class=ic data-a=x aria-label=Close>✕</button></div>
 ${fld('Name','<input type=text name=name maxlength=60 required>')}
 <div class=lbl>Category</div>${CATS.map((c,i)=>`<label class=chip><input type=radio name=cat value=${c} ${i?'':'checked'}>${c}</label>`).join('')}
 <div class=lbl>Frequency</div>${seg('type',['Daily','X / week','Days'],'X / week')}
 <div id=fx>${fld('Days per week (1–7)','<input type=number name=n min=1 max=7 value=4>')}</div>
 <div id=fd class=hide>${WD.map((d,i)=>`<label class=chip><input type=checkbox name=day value=${i}>${d}</label>`).join('')}</div>
 ${fld('Start date',`<input type=date name=start value="${today()}">`)}
 <label class=chip><input type=checkbox name=multi>Allow multiple sessions per day</label>
 <div class=lbl>Milestone</div>${seg('kind',['Streak','Count'],'Count')}
 ${fld('Target','<input type=number name=target min=1 value=15>')}
 <div class=lbl>If I miss a period</div>${seg('policy',['Reset','Pause','Ask'],'Reset')}
 ${fld('Reward (optional)','<input type=text name=reward maxlength=60>')}${fld('Reward link (optional, http/https)','<input type=url name=url>')}
 <button class=btn data-a=sh>Save habit</button>`);
  $('#sheet').onchange=e=>{if(e.target.name==='type'){$('#fx').classList.toggle('hide',e.target.value!=='X / week');$('#fd').classList.toggle('hide',e.target.value!=='Days')}}}
function saveHabit(){
  const name=val('name').trim();if(!name)return toast('Please enter a name');
  const tv=val('type'),type=tv==='Daily'?'daily':tv==='Days'?'days':'weekly',days=[...document.querySelectorAll('#sheet [name=day]:checked')].map(i=>+i.value);
  if(type==='days'&&!days.length)return toast('Pick at least one day');
  const url=val('url').trim();if(url&&!safeUrl(url))return toast('Link must start with http:// or https://');
  const start=val('start')||today();
  S.habits.push({id:uid(),name,cat:val('cat'),type,n:Math.min(7,Math.max(1,+val('n')||4)),days,start,multi:document.querySelector('#sheet [name=multi]').checked,
    ms:{kind:val('kind').toLowerCase(),target:Math.max(1,+val('target')||1),policy:val('policy').toLowerCase(),reward:val('reward').trim(),url},
    prog:0,best:0,completed:0,resets:0,attempts:[],evals:[],attemptStart:start,evalFrom:type==='daily'?start:wk(start)});
  log('habit_created');save();sheet();render()}
function fTask(){sheet(`<div class="row sp"><h2 class=num>New task</h2><button class=ic data-a=x aria-label=Close>✕</button></div>
 ${fld('Title','<input type=text name=title maxlength=100>')}<div class=lbl>Priority</div>${seg('pri',['High','Medium','Low'],'Medium')}
 <div class=row>${fld('Due date (optional)','<input type=date name=due>')}${fld('Time (optional)','<input type=time name=time>')}</div>
 ${fld('Category',`<select name=cat>${CATS.map(c=>`<option>${c}</option>`).join('')}</select>`)}
 <div class=lbl>Milestone</div>${seg('mode',['Once on completion','Every work log'],'Once on completion')}
 <div id=wl class=hide>${fld('Every N hours worked','<input type=number name=every min=0.25 step=0.25 value=5>')}<div class=lbl>After each reward</div>${seg('after',['Reset to 0','Carry over','Keep adding'],'Carry over')}</div>
 ${fld('Reward (optional)','<input type=text name=reward maxlength=60>')}${fld('Reward link (optional)','<input type=url name=url>')}
 <button class=btn data-a=st>Create task</button>`);
  $('#sheet').onchange=e=>{if(e.target.name==='mode')$('#wl').classList.toggle('hide',e.target.value==='Once on completion')}}
function saveTask(){
  const title=val('title').trim();if(!title)return toast('Please enter a title');const url=val('url').trim();if(url&&!safeUrl(url))return toast('Link must start with http:// or https://');
  const wl=val('mode')==='Every work log';
  S.tasks.push({id:uid(),title,pri:val('pri'),cat:val('cat'),due:val('due')||null,time:val('due')?val('time')||null:null,status:'Not Started',start:today(),mp:0,fired:0,
    ms:{mode:wl?'worklog':'once',every:Math.max(.25,+val('every')||5),after:val('after')==='Keep adding'?'add':val('after')==='Carry over'?'carry':'reset',reward:val('reward').trim(),url}});
  log('task_created');save();sheet();render()}
function taskDetail(id){
  const k=S.tasks.find(x=>x.id===id);if(!k)return;view={task:id};tab='task';
  const run=S.timer&&S.timer.id===id,paused=run&&!S.timer.run,ses=S.sessions.filter(s=>s.t===id).sort((a,b)=>a.start-b.start);
  const ev=k.ms.every*3600;
  $('#tabs').hidden=true;
  $('#app').innerHTML=`<div class=row><button class=ic data-a=back aria-label=Back>←</button><h1 style="font-size:24px;margin:0">${esc(k.title)}</h1></div>
  <p class=mu>${k.pri} · ${esc(k.cat)} · ${k.due?'Due '+k.due+(k.time?' '+k.time:''):'No deadline'} · ${k.status}</p>
  <div class=card><div class="timer num" data-tick=${id} aria-live=off>${clock(el(k))}</div><div class=row>
  ${k.status==='Completed'?'<button class="btn out" data-a=reopen data-id='+id+'>Reopen</button>':run&&S.timer.run?`<button class="btn out" data-a=pause>Pause</button><button class=btn data-a=stop>Stop &amp; save</button>`:paused?`<button class=btn data-a=resume>Resume</button><button class="btn out" data-a=stop>Stop &amp; save</button>`:`<button class=btn data-a=start data-id=${id}>Start</button>`}</div></div>
  ${k.ms.mode==='worklog'?`<div class=card><b>Milestone</b> <span class=am>${hm(k.mp)} / ${k.ms.every}h</span>${bar(k.mp,ev)}<div class=mu>${esc(k.ms.reward||'')}</div></div>`:k.ms.reward?`<div class=card><b>Reward on completion:</b> ${esc(k.ms.reward)}</div>`:''}
  <div class=lbl>Work log · total ${hm(worked(k))}</div><div class=card>${ses.map(s=>`<div class="row sp"><span>${new Date(s.start).toLocaleString([],{dateStyle:'short',timeStyle:'short'})} · ${s.type==='timer'?'Timer':'Manual'}${s.note?' · '+esc(s.note):''}</span><b>${hm(s.dur)}</b></div>`).join('')||'<span class=mu>No sessions yet.</span>'}</div>
  <div class=row><button class="btn out" data-a=lt data-id=${id}>+ Log time</button>${k.status!=='Completed'?`<button class=btn data-a=tc data-id=${id}>Mark complete</button>`:''}</div>
  <button class="btn danger" style="margin-top:12px" data-a=dt data-id=${id}>Delete task</button>`}
function habitDetail(id){
  const h=S.habits.find(x=>x.id===id);if(!h)return;const t=today(),p=period(h,t),set=hDays(h),ws=wk(t),st=status(h);
  sheet(`<div class="row sp"><h2 class=num style="margin:0">${esc(h.name)}</h2><button class=ic data-a=x aria-label=Close>✕</button></div>
  <p><span class="pill ${st==='At risk'?'dg':'ok'}">${st}</span></p>
  <div class=card><div class=row>${ring(done(h,p),req(h))}<div class=grow><b>${sched(h)}</b><div class="days" style="margin-top:8px">${WD.map((d,i)=>`<i class="${set.has(add(ws,i))?'f':''}" title="${d}">${d[0]}</i>`).join('')}</div></div></div></div>
  <div class=card><span class=mu>${h.ms.kind==='streak'?'Streak':'Landmark'}</span><div class=num style="font-size:32px">${h.prog} / ${h.ms.target} <small class=mu>${unit(h)}</small></div>${bar(h.prog,h.ms.target)}<div class=mu>${h.ms.reward?'Reward: '+esc(h.ms.reward):''}</div></div>
  <div class=card><b>History</b><div class=mu>${S.checkins.filter(c=>c.h===id).length} check-ins · longest streak ${h.best} · ${h.completed} completed · ${h.resets} resets</div>
  ${h.attempts.slice().reverse().map(a=>`<div class="row sp"><span>${a.s} → ${a.e}</span><b class="${a.state==='Reset'?'dg':'ok'}">${a.state} (${a.prog})</b></div>`).join('')}</div>
  <div class=row><button class="btn out" data-a=arch data-id=${id}>Archive</button><button class="btn danger" data-a=dh data-id=${id}>Delete</button></div>`)}
function settings(){sheet(`<div class="row sp"><h2 class=num>Settings</h2><button class=ic data-a=x aria-label=Close>✕</button></div>
 <div class=lbl>Theme</div>${seg('theme',['system','light','dark'],S.theme)}
 <button class="btn out" data-a=exp style="margin-bottom:10px">Export data (JSON)</button>
 <label class="btn out" style="display:grid;place-items:center;margin-bottom:10px;cursor:pointer">Import data<input type=file accept=.json id=imp hidden></label>
 <button class="btn danger" data-a=wipe>Delete all data</button>`);
 $('#sheet').onchange=e=>{if(e.target.name==='theme'){S.theme=e.target.value;theme();save()}if(e.target.id==='imp'){e.target.files[0].text().then(t=>{try{S=JSON.parse(t);save();location.reload()}catch{toast('Invalid file')}})}}}
function theme(){const r=document.documentElement;S.theme==='system'?r.removeAttribute('data-theme'):r.dataset.theme=S.theme}

/* ---------- Events ---------- */
const byId=(a,id)=>S[a].find(x=>x.id===id);
document.addEventListener('click',e=>{
  if(e.target.id==='sheet')return sheet();
  const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a,id=b.dataset.id;if(a==='tab'||a==='dh'||a==='dt')e.preventDefault();
  const h=byId('habits',id),k=byId('tasks',id);
  ({tab:()=>{tab=id;view=null;$('#tabs').hidden=false;render()},
   x:()=>sheet(),set:settings,nh:()=>{e.preventDefault();fHabit()},nt:()=>{e.preventDefault();fTask()},sh:saveHabit,st:saveTask,
   ci:()=>{if(hDays(h).has(today())&&!h.multi){const c=S.checkins.filter(c=>c.h===id&&c.d===today()).pop();S.checkins=S.checkins.filter(x=>x!==c);if(h.prog>0&&(h.ms.kind==='count'||h.type==='daily'))h.prog--;log('checkin_undone',id);save();render()}else checkin(h)},
   hd:()=>habitDetail(id),rs:()=>{reset(h,'ask');save();render()},keep:()=>{h.ask=null;save();render()},
   arch:()=>{h.archived=true;sheet();save();render()},unarch:()=>{h.archived=false;h.evalFrom=period(h,today())[0];save();render()},
   dh:()=>{if(confirm('Delete this habit and its check-ins?')){S.habits=S.habits.filter(x=>x!==h);S.checkins=S.checkins.filter(c=>c.h!==id);sheet();save();render()}},
   tc:()=>k.status==='Completed'?(k.status='In Progress',save(),tab==='task'?taskDetail(id):render()):(complete(k),tab==='task'&&taskDetail(id)),
   td:()=>taskDetail(id),back:()=>{tab='today';$('#tabs').hidden=false;render()},
   start:()=>{startTimer(k);taskDetail(id)},pause:()=>{S.timer.acc=el(k0());S.timer.run=false;save();taskDetail(S.timer.id)},
   resume:()=>{S.timer.at=Date.now();S.timer.run=true;save();taskDetail(S.timer.id)},stop:()=>{const i=S.timer.id;stopTimer();save();taskDetail(i)},
   reopen:()=>{k.status='In Progress';log('task_reopened',id);save();taskDetail(id)},
   dt:()=>{if(confirm('Delete this task?')){if(S.timer?.id===id)S.timer=null;S.tasks=S.tasks.filter(x=>x!==k);S.sessions=S.sessions.filter(s=>s.t!==id);save();tab='today';$('#tabs').hidden=false;render()}},
   lt:()=>{sheet(`<div class="row sp"><h2 class=num>Log time</h2><button class=ic data-a=x aria-label=Close>✕</button></div><div class=row>${fld('Hours','<input type=number name=hh min=0 value=0>')}${fld('Minutes','<input type=number name=mm min=0 max=59 value=30>')}</div>${fld('Note','<input type=text name=note>')}<button class=btn data-a=slt data-id=${id}>Save</button>`)},
   slt:()=>{const d=(+val('hh')||0)*3600+(+val('mm')||0)*60;if(d<=0)return toast('Enter a duration');addSession(k,d,'manual',val('note'));sheet();save();taskDetail(id)},
   claim:()=>{const r=byId('rewards',id);r.status='claimed';r.claimedAt=Date.now();log('reward_claimed',id);save();render()},
   exp:()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,1)],{type:'application/json'}));a.download='tracker-export-'+today()+'.json';a.click()},
   wipe:()=>{if(confirm('Delete everything? This cannot be undone.')){localStorage.removeItem('ht1');location.reload()}}})[a]?.()});
const k0=()=>S.tasks.find(x=>x.id===S.timer.id);
document.addEventListener('input',e=>{if(e.target.id==='q'){q=e.target.value;render()}});
document.addEventListener('change',e=>{
  if(e.target.name==='fil'){fil=e.target.value;render()}
  if(e.target.name==='rs'){view={seg:e.target.value};render()}
  if(e.target.name==='ms'){view={m:e.target.value};render()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')sheet()});
setInterval(()=>document.querySelectorAll('[data-tick]').forEach(n=>{const k=byId('tasks',n.dataset.tick);if(k)n.textContent=clock(el(k))}),1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){evaluate();tab==='task'?0:render()}});
theme();evaluate();render();
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js').catch(()=>{});
