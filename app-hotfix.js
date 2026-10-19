(function(){
  function ensureBillingTab(){
    const nav=document.querySelector('nav.tabbar');
    if(!nav)return null;
    let tab=document.getElementById('billingTabBtn');
    if(!tab){
      tab=document.createElement('button');
      tab.id='billingTabBtn';
      tab.type='button';
      tab.dataset.view='facturation';
      tab.style.display='none';
      tab.innerHTML='<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M6 2h9l3 3v17H6z"></path><path d="M9 10h6M9 14h6M9 18h4"></path><path d="M15 2v4h4"></path></svg>Facturation';
      nav.appendChild(tab);
      tab.addEventListener('click',function(ev){
        ev.preventDefault();
        ev.stopPropagation();
        if(typeof billingOpenView==='function')billingOpenView();
      },true);
    }
    return tab;
  }

  function install(){
    if(typeof billingCanUse!=='function'||typeof billingEnter!=='function')return false;

    window.billingCanUse=function(){
      try{
        if(!user||!['technician','platform_admin','admin'].includes(profile?.role))return false;
        if(!currentCompanyId())return true;
        return isCompanyTechnician()&&companyEmploymentType()==='auto';
      }catch{return false}
    };
    window.billingCanEdit=function(){return window.billingCanUse()};

    window.billingSyncAvailability=function(){
      const allowed=window.billingCanUse();
      const history=document.getElementById('billingHistoryBtn');
      if(history)history.style.display=allowed?'inline-flex':'none';
      const tab=ensureBillingTab();
      if(tab)tab.style.display=allowed?'flex':'none';
      document.body.classList.toggle('billing-solo',allowed);
      if(!allowed&&document.getElementById('view-facturation')?.classList.contains('active')){
        document.querySelector('.tabbar button[data-view="historique"]')?.click();
      }
    };

    window.billingOpenView=function(){
      if(!window.billingCanUse()){
        if(typeof toast==='function')toast('La facturation est disponible pour les techniciens indépendants, les auto-entrepreneurs et l’espace personnel Platform Admin');
        return;
      }
      window.scrollTo(0,0);
      document.querySelectorAll('.tabbar button').forEach(x=>x.classList.remove('active'));
      const tab=ensureBillingTab();if(tab)tab.classList.add('active');
      document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s.id==='view-facturation'));
      billingEnter();
    };

    const history=document.getElementById('billingHistoryBtn');
    if(history)history.onclick=window.billingOpenView;
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