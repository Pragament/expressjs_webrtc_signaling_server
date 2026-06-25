const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://wmlgywjigexyrgpjlztf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hk6pKPo2ujDHCYvylvbY0g_P6B1v_PN'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function clearSubs() {
    // Delete all subscriptions (filter by id != 'dummy' since eq or something is needed, we'll just delete where id is not null)
    const { data, error } = await supabase.from('push_subscriptions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    console.log("Cleared old subscriptions", error || "Success");
}

clearSubs();
