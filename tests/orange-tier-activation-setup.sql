\set ON_ERROR_STOP on
insert into public.teams(id) values ('11111111-1111-1111-1111-111111111111');
insert into public.profiles values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',true);
insert into public.user_settings values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{"keep":true}'),('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','{}');
insert into public.team_members values
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','active',null),
 ('11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','active',null);
insert into public.interventions values
 ('00000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-09-15','Souterrain',133,'{"supplement":{"amount":35.6,"comment":"APIE"}}'),
 ('00000000-0000-0000-0000-000000000002','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-10-15','Aérien',180,'{}'),
 ('00000000-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'sfr','Réussite','2026-10-15','Aérien',130,'{}'),
 ('00000000-0000-0000-0000-000000000004','cccccccc-cccc-cccc-cccc-cccccccccccc','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-10-15','Aérien',180,'{}'),
 ('00000000-0000-0000-0000-000000000005','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Échec','2026-10-15','Aérien',0,'{}'),
 ('00000000-0000-0000-0000-000000000006','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111',null,'orange','Réussite','2026-08-31','Aérien',150,'{}');
