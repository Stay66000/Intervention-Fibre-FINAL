import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('la grille Orange et les dates initiales correspondent aux tarifs confirmés',()=>{
 const grid=JSON.parse(readFileSync(new URL('../supabase/seed/orange-tier-grid.json',import.meta.url),'utf8'));
 assert.deepEqual(grid.schedule,[{from:'2026-09-01',tier:2},{from:'2026-10-01',tier:1}]);
 assert.deepEqual(grid.prices.aerien,{'1':200,'2':180,'3':120});
 assert.deepEqual(grid.prices.souterrain,{'1':140,'2':126,'3':84});
 assert.deepEqual(grid.prices.immeuble,{'1':68,'2':61,'3':40.8});
 assert.deepEqual(grid.prices.sav,{'1':45,'2':40.5,'3':27});
 assert.deepEqual(grid.prices.plp,{'1':45,'2':40.5,'3':27});
 assert.deepEqual(grid.prices['plp sans client'],{'1':15,'2':13.5,'3':9});
 assert.deepEqual(grid.prices.apie,{'1':47,'2':42.3,'3':28.2});
 const activation=readFileSync(new URL('../supabase/seed/activate-orange-team-tiers.sql',import.meta.url),'utf8');
 const embedded=activation.match(/'(\[\{"from"[^']+)'::jsonb,\s*'(\{"aerien"[^']+)'::jsonb/);
 assert.ok(embedded,'configuration d’activation introuvable');
 assert.deepEqual(JSON.parse(embedded[1]),grid.schedule);
 assert.deepEqual(JSON.parse(embedded[2]),grid.prices);
});
