const year=document.getElementById('year');year.textContent=new Date().getFullYear();
const toast=document.getElementById('toast');let toastTimer;
function notify(message){toast.textContent=message;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),4500)}
function formMessage(form){const data=Object.fromEntries(new FormData(form).entries());const parts=[];
for(const [key,value] of Object.entries(data)){if(['name','email','organization','consent'].includes(key)||!value)continue;parts.push(key.replace(/([A-Z])/g,' $1').replace(/_/g,' ')+': '+String(value).trim());}
return parts.join('\n');}
for(const id of ['candidateForm','employerForm']){
 const form=document.getElementById(id);form.addEventListener('submit',async event=>{
  event.preventDefault();if(!form.reportValidity())return;
  const button=form.querySelector('[type="submit"]'),note=form.querySelector('.form-foot'),original=button.innerHTML;
  const data=Object.fromEntries(new FormData(form).entries());
  const fields=Object.fromEntries(Object.entries(data).filter(([key])=>!['name','email','organization','consent'].includes(key)));\n  const payload={name:data.name,email:data.email,organization:data.organization||'',interest:form.dataset.interest,message:formMessage(form),fields,consent:data.consent==='yes',locale:'en'};
  button.disabled=true;button.textContent='Submitting…';note.textContent='Sending securely…';
  try{const response=await fetch('/api/v1/enquiries',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Submission failed.');
   note.textContent='Received. Your reference is '+result.reference+'. Our team will review your registration.';
   notify(note.textContent);form.reset();
  }catch(error){note.textContent=error.message==='Failed to fetch'?'Connection problem. Please try again.':error.message;notify(note.textContent);}
  finally{button.disabled=false;button.innerHTML=original;}
 });
}

async function loadPublishedJobs(){const host=document.getElementById('publishedJobs');if(!host)return;try{const response=await fetch('/api/v1/jobs',{headers:{accept:'application/json'}});const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to load jobs');if(!data.items.length){host.innerHTML='<div class="published-job-empty">No verified vacancies are open at the moment. Register your interest and we will review relevant opportunities as they become available.</div>';return}host.innerHTML=data.items.map(job=>'<article class="published-job"><div><div class="published-job-meta">'+escapeHtml(job.sector)+' · '+escapeHtml(job.location)+'</div><h3>'+escapeHtml(job.title)+'</h3><p>'+escapeHtml(job.description)+'</p><p>'+escapeHtml(job.employment_type)+' · '+escapeHtml(job.headcount)+' position(s)'+(job.gross_pay_range?' · '+escapeHtml(job.gross_pay_range):'')+'</p></div><a class="btn btn-red" href="#candidate">Register interest ↗</a></article>').join('')}catch{host.innerHTML='<div class="published-job-empty">Published opportunities could not be loaded right now.</div>'}}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
loadPublishedJobs();
