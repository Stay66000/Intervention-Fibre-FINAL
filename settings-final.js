(function(){
  'use strict';
  // HOTFIX : la refonte Réglages est temporairement désactivée.
  // On conserve le fichier pour éviter les erreurs de chargement, mais aucun
  // observateur DOM ni déplacement d'éléments n'est exécuté sur la production.
  window.FibreSettingsFinal={
    open(){
      try{
        const overlay=document.getElementById('settingsOverlay');
        if(overlay) overlay.classList.add('active');
      }catch{}
    },
    arrange(){}
  };
})();
