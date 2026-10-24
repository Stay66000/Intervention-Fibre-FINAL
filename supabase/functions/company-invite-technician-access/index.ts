import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.95.3';
import { createInviteHandler } from './handler.ts';

Deno.serve(createInviteHandler(createClient, (name) => Deno.env.get(name)));
