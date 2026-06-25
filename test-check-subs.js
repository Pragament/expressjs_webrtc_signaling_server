const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://wmlgywjigexyrgpjlztf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hk6pKPo2ujDHCYvylvbY0g_P6B1v_PN'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkSubs() {
    const { data, error } = await supabase.from('push_subscriptions').select('*');
    console.log(JSON.stringify(data, null, 2));
}

checkSubs();
