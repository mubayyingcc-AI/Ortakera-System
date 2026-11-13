const $=id=>document.getElementById(id),message=$('message');
async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',...options,headers:{accept:'application/json',...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}});const d=await r.json().catch(()=>({error:'Unexpected server response'}));if(!r.ok)throw Error(d.error||'Request failed');return d}
function note(text){message.textContent=text}
function formData(form){return Object.fromEntries(new FormData(form).entries())}
function show(account){loadProfile();loadMemberJobs();loadMemberApplications();loadEmployerWorkspace(account);$('signedOut').classList.add('hidden');$('signedIn').classList.remove('hidden');$('welcome').textContent='Welcome, '+account.full_name;$('accountDetails').textContent='Email: '+account.email+'\nAccount type: '+account.account_type+'\nMembership: '+account.plan+'\nStatus: '+account.account_status+(account.organization?'\nOrganisation: '+account.organization:'');$('requestSubscription').disabled=account.plan==='subscribed'||account.account_status!=='active';loadRequests()}
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

async function loadEmployerWorkspace(account){
 const form=$('employerForm');if(!form)return;
 const enabled=account.account_type==='employer'&&account.account_status==='active';
 form.querySelectorAll('input,select,textarea,button').forEach(el=>el.disabled=!enabled);
 $('employerMessage').textContent=enabled?'Approved employer access. New hiring requirements enter review before publication.':account.account_type==='employer'?'Your employer application is pending review.':'Employer tools are reserved for approved employer accounts.';
 if(!enabled)return;
 try{
  const [vacancies,applications]=await Promise.all([api('/api/v1/employer/vacancies'),api('/api/v1/employer/applications')]);
  const host=$('employerVacancies');host.replaceChildren();
  if(!vacancies.items.length)host.textContent='No hiring requirements submitted yet.';
  for(const v of vacancies.items){const item=document.createElement('p');item.textContent=[v.reference_code,v.title,v.location,v.status,'Applications: '+v.application_count].join(' · ');host.append(item)}
  const appHost=$('employerApplications');appHost.replaceChildren();
  if(!applications.items.length)appHost.textContent='No applications have been received for your published vacancies.';
  for(const item of applications.items){const row=document.createElement('div');row.className='account-status';const summary=document.createElement('p');summary.textContent=[item.title,item.reference_code,item.status,new Date(item.created_at).toLocaleDateString()].join(' · ');row.append(summary);const select=document.createElement('select');for(const status of ['screening','shortlisted','interview','offered','declined']){const option=document.createElement('option');option.value=status;option.textContent=status;option.selected=status===item.status;select.append(option)}const button=document.createElement('button');button.type='button';button.textContent='Update application';button.addEventListener('click',async()=>{button.disabled=true;try{await api('/api/v1/employer/applications/'+encodeURIComponent(item.id),{method:'PATCH',body:JSON.stringify({status:select.value})});await loadEmployerWorkspace(account)}catch(error){$('employerMessage').textContent=error.message;button.disabled=false}});row.append(select,button);appHost.append(row)}
 }catch(e){$('employerMessage').textContent=e.message}
}
$('employerForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;$('employerMessage').textContent='Submitting for review…';
 try{const payload=formData(form);const d=await api('/api/v1/employer/vacancies',{method:'POST',body:JSON.stringify(payload)});$('employerMessage').textContent=d.message+' Reference: '+d.item.reference_code;form.reset();const me=await api('/api/v1/member/me');await loadEmployerWorkspace(me.account)}
 catch(err){$('employerMessage').textContent=err.message}
 finally{button.disabled=false}
});

$('resetRequestForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;$('resetRequestMessage').textContent='Sending request…';
 try{const d=await api('/api/v1/member/password-reset/request',{method:'POST',body:JSON.stringify(formData(form))});$('resetRequestMessage').textContent=d.message;form.reset()}
 catch(error){$('resetRequestMessage').textContent=error.message}
 finally{button.disabled=false}
});
$('resetCompleteForm')?.addEventListener('submit',async e=>{
 e.preventDefault();const form=e.currentTarget,button=form.querySelector('button'),token=new URLSearchParams(location.search).get('reset');button.disabled=true;$('resetCompleteMessage').textContent='Updating password…';
 try{const d=await api('/api/v1/member/password-reset/complete',{method:'POST',body:JSON.stringify({token,password:formData(form).password})});$('resetCompleteMessage').textContent=d.message;form.reset();history.replaceState({},'',location.pathname);$('resetCompleteCard').classList.add('hidden')}
 catch(error){$('resetCompleteMessage').textContent=error.message}
 finally{button.disabled=false}
});
$('resendVerification')?.addEventListener('click',async e=>{
 const button=e.currentTarget;button.disabled=true;
 try{const d=await api('/api/v1/member/verify-email/resend',{method:'POST',body:'{}'});$('emailVerificationStatus').textContent=d.message}
 catch(error){$('emailVerificationStatus').textContent=error.message}
 finally{button.disabled=false}
});
async function handleAccountActionLink(){
 const params=new URLSearchParams(location.search),verifyToken=params.get('verify'),resetToken=params.get('reset');
 if(resetToken){$('resetCompleteCard')?.classList.remove('hidden');$('resetCompleteMessage').textContent='Enter a new password to complete the reset.'}
 if(verifyToken){
  $('verifyCard')?.classList.remove('hidden');$('verifyMessage').textContent='Verifying your email address…';
  try{const d=await api('/api/v1/member/verify-email/confirm',{method:'POST',body:JSON.stringify({token:verifyToken})});$('verifyMessage').textContent=d.message;history.replaceState({},'',location.pathname);await loadMe()}
  catch(error){$('verifyMessage').textContent=error.message}
 }
}
handleAccountActionLink();
