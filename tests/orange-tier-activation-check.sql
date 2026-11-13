\set ON_ERROR_STOP on
do $$ begin
 if (select count(*) from public.intervention_supplement_types where team_id='11111111-1111-1111-1111-111111111111' and operator='orange' and name='ETCFO' and amount=32.40 and active)<>1 then raise exception 'Complément ETCFO incorrect'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000001')<>168.3 then raise exception 'Recalcul septembre incorrect'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000002')<>200 then raise exception 'Recalcul octobre incorrect'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000003')<>130 then raise exception 'SFR modifié'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000004')<>180 then raise exception 'Compte tiers modifié'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000005')<>0 then raise exception 'Échec modifié'; end if;
 if (select applied_amount from public.interventions where id='00000000-0000-0000-0000-000000000006')<>150 then raise exception 'Ancienne période modifiée'; end if;
 if (select preferences->>'orange_tier_team_id' from public.user_settings where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')<>'11111111-1111-1111-1111-111111111111' then raise exception 'Préférence absente'; end if;
 if (select preferences->>'keep' from public.user_settings where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')<>'true' then raise exception 'Autre préférence perdue'; end if;
 if (select preferences #>> '{orange_total_discount,percent}' from public.user_settings where user_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')<>'20' then raise exception 'Réduction Orange modifiée'; end if;
end $$;
