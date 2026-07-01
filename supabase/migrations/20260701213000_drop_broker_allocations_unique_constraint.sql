-- Drop the uniqueness constraint that limits a user to one allocation per broker and account type.
-- This allows having multiple accounts (allocations) of the same type under the same broker.
alter table public.broker_allocations drop constraint if exists broker_allocations_user_broker_type_unique;
