-- Create a table to store push subscriptions
create table public.push_subscriptions (
    id uuid default gen_random_uuid() primary key,
    peer_name text not null,
    subscription jsonb not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Set up Row Level Security (RLS)
alter table public.push_subscriptions enable row level security;

-- Allow anyone to insert their subscription
create policy "Allow anonymous inserts" on public.push_subscriptions
    for insert to anon
    with check (true);

-- Allow anyone to read all subscriptions (so the edge function or clients can see them)
create policy "Allow anonymous reads" on public.push_subscriptions
    for select to anon
    using (true);

-- Allow anonymous users to delete their own subscription if they want
create policy "Allow anonymous deletes" on public.push_subscriptions
    for delete to anon
    using (true);
