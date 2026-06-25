const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://wmlgywjigexyrgpjlztf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hk6pKPo2ujDHCYvylvbY0g_P6B1v_PN'; // from docs/index.html
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testPush() {
    try {
        const { data, error } = await supabase.functions.invoke('send-push', {
            body: {
                senderName: 'TestUser',
                message: 'Hello world',
                image: null
            }
        });
        console.log('Data:', data);
        console.log('Error:', error);
    } catch (e) {
        console.error('Exception:', e);
    }
}

testPush();
