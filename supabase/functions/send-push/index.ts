import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { message, senderName, image } = await req.json()

    // Initialize Supabase Client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch all push subscriptions
    const { data: subscriptions, error } = await supabaseClient
      .from('push_subscriptions')
      .select('*')

    if (error) throw error

    // Configure Web Push with VAPID keys
    webpush.setVapidDetails(
      'mailto:admin@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
      Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
    )

    // Send push notification to all subscribers EXCEPT the sender (if we can identify them)
    // For simplicity, we just broadcast to everyone with a different name
    const pushPayload = JSON.stringify({
      title: `New message from ${senderName}`,
      body: message || (image ? '📷 Sent an image' : 'New message'),
      icon: 'https://expressjs-webrtc-signaling-server.onrender.com/favicon.ico' // Update with real icon if needed
    })

    const sendPromises = subscriptions
      .filter((sub) => sub.peer_name !== senderName)
      .map(async (sub) => {
        try {
          await webpush.sendNotification(sub.subscription, pushPayload)
        } catch (e) {
          console.error(`Failed to send push to ${sub.peer_name}:`, e)
          // If the subscription is gone/expired, we could delete it from the database here
          if (e.statusCode === 410 || e.statusCode === 404) {
            await supabaseClient.from('push_subscriptions').delete().eq('id', sub.id)
          }
        }
      })

    await Promise.all(sendPromises)

    return new Response(
      JSON.stringify({ success: true, count: sendPromises.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
