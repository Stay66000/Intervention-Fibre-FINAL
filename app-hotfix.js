(function(){
  'use strict';

  function removeBottomBillingTab(){
    const tab=document.getElementById('billingTabBtn');
    if(tab)tab.remove();
  }

  function ensureHistoryBillingButton(){
    let btn=document.getElementById('billingHistoryBtn');
    if(btn)return btn;
    const view=document.getElementById('view-historique');
    if(!view)return null;
    const head=view.querySelector('.view-head');
    const box=document.createElement('div');
    box.id='billingHistoryEntry';
    box.className='card';
    box.style.cssText='padding:12px;margin-bottom:12px;display:none';
    box.innerHTML='<button class="btn-soft" id="billingHistoryBtn" type="button" style="width:100%">🧾 Ouvrir la facturation</button>';
    if(head)head.insertAdjacentElement('afterend',box);else view.prepend(box);
    return document.getElementById('billingHistoryBtn');
  }

  function install(){
    removeBottomBillingTab();
    if(typeof billingCanUse!=='function'||typeof billingEnter!=='function')return false;

    window.billingCanUse=function(){
      try{
        if(!user||!['technician','platform_admin','admin'].includes(profile?.role))return false;
        if(!currentCompanyId())return true;
        return isCompanyTechnician()&&companyEmploymentType()==='auto';
      }catch{return false}
    };
    window.billingCanEdit=function(){return window.billingCanUse()};

    window.billingOpenView=function(){
      if(!window.billingCanUse()){
        if(typeof toast==='function')toast('La facturation est disponible pour les techniciens indépendants, les auto-entrepreneurs et l’espace personnel Platform Admin');
        return;
      }
      window.scrollTo(0,0);
      document.querySelectorAll('.tabbar button').forEach(x=>x.classList.toggle('active',x.dataset.view==='historique'));
      document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s.id==='view-facturation'));
      billingEnter();
    };

    window.billingSyncAvailability=function(){
      removeBottomBillingTab();
      const allowed=window.billingCanUse();
      const btn=ensureHistoryBillingButton();
      const entry=document.getElementById('billingHistoryEntry');
      if(btn){btn.style.display=allowed?'block':'none';btn.onclick=window.billingOpenView}
      if(entry)entry.style.display=allowed?'block':'none';
      document.body.classList.toggle('billing-solo',allowed);
      if(!allowed&&document.getElementById('view-facturation')?.classList.contains('active')){
        document.querySelector('.tabbar button[data-view="historique"]')?.click();
      }
    };

    const btn=ensureHistoryBillingButton();
    if(btn)btn.onclick=window.billingOpenView;
    window.billingSyncAvailability();
    return true;
  }

  let tries=0;
  const timer=setInterval(function(){
    tries++;
    if(install()||tries>40)clearInterval(timer);
  },250);
  install();
})();