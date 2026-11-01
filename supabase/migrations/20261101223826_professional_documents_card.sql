alter table public.professional_documents drop constraint professional_documents_kind_check;
alter table public.professional_documents add constraint professional_documents_kind_check check (kind in ('AIPR','CACES / R486','Habilitation électrique','Carte pro','Permis de conduire','Visite médicale','Autre'));
