\set ON_ERROR_STOP on
insert into public.teams values ('11111111-1111-1111-1111-111111111111');
-- An intervention created before opt-in keeps its original base and complement.
insert into public.interventions values
 ('00000000-0000-0000-0000-000000000009','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-10-12','Aérien',180,'{"supplement":{"amount":35.6,"comment":"APIE"}}');
insert into private.orange_team_tier_config (team_id,allowed_users,schedule,prices) values (
 '11111111-1111-1111-1111-111111111111',
 array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid],
 '[{"from":"2026-09-01","tier":2},{"from":"2026-10-01","tier":1}]',
 '{"aerien":{"1":200,"2":180,"3":120},"souterrain":{"1":140,"2":126,"3":84},"immeuble":{"1":68,"2":61,"3":40.8},"sav":{"1":45,"2":40.5,"3":27},"plp":{"1":45,"2":40.5,"3":27},"plp sans client":{"1":15,"2":13.5,"3":9},"apie":{"1":47,"2":42.3,"3":28.2}}'
);
update public.interventions set operator_data=operator_data where id='00000000-0000-0000-0000-000000000009';
do $$ begin
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000009')<>247 then raise exception 'Recalcul historique erroné'; end if;
end $$;
insert into public.interventions values
 ('00000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-09-15','Souterrain',133,'{"supplement":{"amount":35.6,"comment":"APIE"}}'),
 ('00000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-10-15','Aérien',180,'{}'),
 ('00000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'sfr','Réussite','2026-10-15','Aérien',130,'{}'),
 ('00000000-0000-0000-0000-000000000004','cccccccc-cccc-cccc-cccc-cccccccccccc','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-10-15','Aérien',180,'{}'),
 ('00000000-0000-0000-0000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Échec','2026-10-15','Aérien',0,'{}'),
 ('00000000-0000-0000-0000-000000000006','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-08-31','Aérien',150,'{}'),
 ('00000000-0000-0000-0000-000000000007','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-10-15','Pré visite',32.4,'{"supplement":{"amount":35.6,"comment":"APIE"}}'),
 ('00000000-0000-0000-0000-000000000011','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-09-04','SAV',40,'{}');
do $$ begin
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000001')<>168.30 then raise exception 'Septembre ou APIE erroné'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000002')<>200 then raise exception 'Octobre erroné'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000003')<>130 then raise exception 'SFR modifié'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000004')<>180 then raise exception 'Tiers non autorisé'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000005')<>0 then raise exception 'Échec modifié'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000006')<>150 then raise exception 'Date antérieure modifiée'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000007')<>79.4 then raise exception 'Catégorie hors grille erronée'; end if;
end $$;
update public.interventions set intervention_date='2026-10-02',operator_data=operator_data where id='00000000-0000-0000-0000-000000000001';
do $$ begin
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000001')<>187 then raise exception 'Changement de mois ou APIE erroné'; end if;
end $$;
update private.orange_team_tier_config set schedule=schedule||'[{"from":"2026-12-01","tier":3}]'::jsonb;
insert into public.interventions values
 ('00000000-0000-0000-0000-000000000008','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-12-02','PLP sans client',12,'{"supplement":{"amount":10,"comment":"Autre"}}');
do $$ begin
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000008')<>19 then raise exception 'Palier 3 ou complément personnalisé erroné'; end if;
end $$;
insert into public.interventions values
 ('00000000-0000-0000-0000-000000000012','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-10-15','Aérien',180,'{"supplement":{"amount":68.0,"comment":"ETCFO + APIE","items":[{"amount":32.4,"comment":"ETCFO"},{"amount":35.6,"comment":"APIE"}]}}'),
 ('00000000-0000-0000-0000-000000000013','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-10-15','Pré visite',32.4,'{"supplement":{"amount":68.0,"comment":"ETCFO + APIE","items":[{"amount":32.4,"comment":"ETCFO"},{"amount":35.6,"comment":"APIE"}]}}');
do $$ begin
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000012')<>279.4 then raise exception 'Deux compléments mal calculés'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000013')<>111.8 then raise exception 'Compléments sur pré visite incorrects'; end if;
end $$;
set test.user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
set role authenticated;
do $$ begin if public.my_orange_team_tiers('11111111-1111-1111-1111-111111111111') is null then raise exception 'Lecture membre refusée'; end if; end $$;
do $$ begin
  if has_table_privilege(current_user,'private.orange_team_tier_config','SELECT') then raise exception 'Table privée accessible'; end if;
end $$;
select public.set_my_orange_team_tier('11111111-1111-1111-1111-111111111111','2026-10-01',3);
reset role;
do $$ begin
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000002')<>120 then raise exception 'Palier historique non recalculé'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000012')<>180.6 then raise exception 'Deux compléments au palier 3 incorrects'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000013')<>93 then raise exception 'Pré visite avec deux compléments mal recalculée'; end if;
 if (select operator_data #>> '{supplement,items,0,amount}' from public.interventions where id='00000000-0000-0000-0000-000000000012')::numeric<>32.4 then raise exception 'ETCFO modifié par le palier'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000001')<>112.2 then raise exception 'APIE ou souterrain historique incorrect'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000003')<>130 then raise exception 'SFR modifié après correction'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000004')<>180 then raise exception 'Compte tiers modifié'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000011')<>40.5 then raise exception 'Un autre mois a été modifié'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000008')<>19 then raise exception 'Un mois futur a été modifié'; end if;
end $$;
set role authenticated;
set test.user_id='cccccccc-cccc-cccc-cccc-cccccccccccc';
do $$ begin if public.my_orange_team_tiers('11111111-1111-1111-1111-111111111111') is not null then raise exception 'Lecture tiers autorisée'; end if; end $$;
do $$ begin
 begin perform public.set_my_orange_team_tier('11111111-1111-1111-1111-111111111111','2026-10-01',1);raise exception 'Modification tiers autorisée';
 exception when raise_exception then if sqlerrm='Modification tiers autorisée' then raise; end if; end;
end $$;
reset role;
set test.user_id='cccccccc-cccc-cccc-cccc-cccccccccccc';
insert into public.interventions values
 ('00000000-0000-0000-0000-000000000010','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-10-15','Aérien',180,'{}');
do $$ begin
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000010')<>180 then raise exception 'Action d’un tiers a appliqué le palier'; end if;
end $$;
