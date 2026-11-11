const $=id=>document.getElementById(id),message=$('message');
async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',...options,headers:{accept:'application/json',...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}});const d=await r.json().catch(()=>({error:'Unexpected server response'}));if(!r.ok)throw Error(d.error||'Request failed');return d}
function note(text){message.textContent=text}
function formData(form){return Object.fromEntries(new FormData(form).entries())}
function show(account){loadProfile();loadMemberJobs();loadMemberApplications();$('signedOut').classList.add('hidden');$('signedIn').classList.remove('hidden');$('welcome').textContent='Welcome, '+account.full_name;$('accountDetails').textContent='Email: '+account.email+'\nAccount type: '+account.account_type+'\nMembership: '+account.plan+'\nStatus: '+account.account_status+(account.organization?'\nOrganisation: '+account.organization:'');$('requestSubscription').disabled=account.plan==='subscribed'||account.account_status!=='active';loadRequests()}
async function loadMe(){try{const d=await api('/api/v1/member/me');show(d.account)}catch{$('signedOut').classList.remove('hidden');$('signedIn').classList.add('hidden')}}
async function submit(form,path){const button=form.querySelector('button');button.disabled=true;try{const d=await api(path,{method:'POST',body:JSON.stringify(formData(form))});if(path.endsWith('/login')){show(d.account);note('Signed in successfully.')}else{form.reset();note(d.message||'Request received.')} }catch(e){note(e.message)}finally{button.disabled=false}}
$('loginForm').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'/api/v1/member/login')});
$('registerForm').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'/api/v1/member/register')});
$('partnerForm').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'/api/v1/member/register')});
async function loadRequests(){try{const d=await api('/api/v1/member/requests');$('requests').textContent=d.items.length?d.items.map(x=>x.request_type+': '+x.request_status+' · '+new Date(x.created_at).toLocaleDateString()).join('\n'):'No requests yet.'}catch(e){$('requests').textContent=e.message}}
$('requestSubscription').addEventListener('click',async()=>{try{const d=await api('/api/v1/member/requests',{method:'POST',body:JSON.stringify({request_type:'subscription'})});$('requestStatus').textContent=d.message;loadRequests()}catch(e){$('requestStatus').textContent=e.message}});
$('logout').addEventListener('click',async()=>{try{await api('/api/v1/member/logout',{method:'POST',body:'{}'});location.reload()}catch(e){note(e.message)}});
loadMe();
async function loadProfile(){try{const d=await api('/api/v1/member/profile');const form=$('profileForm');for(const [key,value] of Object.entries(d.profile||{})){if(form.elements[key])form.elements[key].value=value}}catch(e){$('profileMessage').textContent=e.message}}
$('profileForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;$('profileMessage').textContent='Saving…';try{const d=await api('/api/v1/member/profile',{method:'PATCH',body:JSON.stringify(formData(form))});$('profileMessage').textContent='Profile saved.'}catch(err){$('profileMessage').textContent=err.message}finally{button.disabled=false}});

function safeText(value){return String(value??'')}
async function loadMemberJobs(){
 const host=$('memberJobs');if(!host)return;host.textContent='Loading published opportunities…';
 try{
  const d=await api('/api/v1/member/jobs');host.replaceChildren();
  if(!d.items.length){host.textContent='No verified vacancies are currently published. Check again later.';return}
  for(const item of d.items){
   const card=document.createElement('article');card.className='account-card';card.style.margin='12px 0';
   const title=document.createElement('h3');title.textContent=safeText(item.title);card.append(title);
   const meta=document.createElement('p');meta.className='account-note';meta.textContent=[item.reference_code,item.sector,item.location,item.employment_type,item.gross_pay_range].filter(Boolean).join(' · ');card.append(meta);
   const desc=document.createElement('p');desc.textContent=safeText(item.description);card.append(desc);
   const actions=document.createElement('div');actions.style.display='flex';actions.style.flexWrap='wrap';actions.style.gap='8px';
   const save=document.createElement('button');save.type='button';save.textContent=item.saved?'Remove saved':'Save opportunity';save.addEventListener('click',async()=>{save.disabled=true;try{await api('/api/v1/member/saved-jobs',{method:item.saved?'DELETE':'POST',body:JSON.stringify({reference_code:item.reference_code})});await loadMemberJobs()}catch(e){note(e.message);save.disabled=false}});actions.append(save);
   const apply=document.createElement('button');apply.type='button';apply.textContent=item.applied?'Application submitted':'Apply';apply.disabled=item.applied;apply.addEventListener('click',async()=>{apply.disabled=true;try{await api('/api/v1/member/applications',{method:'POST',body:JSON.stringify({reference_code:item.reference_code})});note('Application submitted.');await loadMemberJobs();await loadMemberApplications()}catch(e){note(e.message);apply.disabled=false}});actions.append(apply);card.append(actions);host.append(card);
  }
 }catch(e){host.textContent=e.message}
}
async function loadMemberApplications(){const host=$('memberApplications');if(!host)return;try{const d=await api('/api/v1/member/applications');host.textContent=d.items.length?d.items.map(x=>x.title+' · '+x.reference_code+' · '+x.status+' · '+new Date(x.created_at).toLocaleDateString()).join('\\n'):'No applications submitted from this account yet.'}catch(e){host.textContent=e.message}}
