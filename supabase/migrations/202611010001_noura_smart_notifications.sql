drop function if exists public.claim_noura_due_reminders();

create or replace function public.claim_noura_due_reminders()
returns table (
  delivery_id bigint,
  subscription_id bigint,
  user_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  reminder_id text,
  reminder_label text,
  reminder_kind text,
  notification_title text,
  notification_body text,
  notification_tag text,
  scheduled_for timestamptz
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select
      subscription.id as subscription_id,
      subscription.user_id,
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      subscription.timezone,
      subscription.last_seen_at,
      user_data.profile,
      user_data.logs,
      user_data.reminders,
      (now() at time zone subscription.timezone)::date as local_date
    from public.noura_push_subscriptions as subscription
    join public.noura_user_data as user_data on user_data.user_id = subscription.user_id
    where subscription.enabled
  ),
  settings as (
    select
      base.*,
      coalesce(base.profile #>> '{notificationPreferences,inactivityEnabled}', 'true') <> 'false' as inactivity_enabled,
      case
        when base.profile #>> '{notificationPreferences,inactivityDays}' ~ '^\d{1,2}$'
          then greatest(1, least(30, (base.profile #>> '{notificationPreferences,inactivityDays}')::integer))
        else 3
      end as inactivity_days,
      case
        when base.profile #>> '{notificationPreferences,inactivityTime}' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
          then base.profile #>> '{notificationPreferences,inactivityTime}'
        else '18:30'
      end as inactivity_time,
      coalesce(base.profile #>> '{notificationPreferences,macroEnabled}', 'true') <> 'false' as macro_enabled,
      case
        when base.profile #>> '{notificationPreferences,macroThreshold}' ~ '^\d+(?:\.\d+)?$'
          then greatest(1, least(1.5, (base.profile #>> '{notificationPreferences,macroThreshold}')::numeric))
        else 1
      end as macro_threshold,
      case when base.profile #>> '{targets,protein}' ~ '^\d+(?:\.\d+)?$' then (base.profile #>> '{targets,protein}')::numeric else 0 end as protein_target,
      case when base.profile #>> '{targets,carbs}' ~ '^\d+(?:\.\d+)?$' then (base.profile #>> '{targets,carbs}')::numeric else 0 end as carbs_target,
      case when base.profile #>> '{targets,fat}' ~ '^\d+(?:\.\d+)?$' then (base.profile #>> '{targets,fat}')::numeric else 0 end as fat_target
    from base
  ),
  meal_candidates as (
    select
      settings.subscription_id,
      settings.user_id,
      settings.endpoint,
      settings.p256dh,
      settings.auth,
      reminder.item ->> 'id' as reminder_id,
      coalesce(nullif(reminder.item ->> 'label', ''), 'meal') as reminder_label,
      'meal'::text as reminder_kind,
      'Before ' || lower(coalesce(nullif(reminder.item ->> 'label', ''), 'your meal')) || '…' as notification_title,
      'Take a quick photo or tell Noura what’s on your plate.'::text as notification_body,
      'noura-' || (reminder.item ->> 'id') || '-' || settings.local_date::text as notification_tag,
      ((settings.local_date + (reminder.item ->> 'time')::time) at time zone settings.timezone) as scheduled_for,
      settings.local_date
    from settings
    cross join lateral jsonb_array_elements(settings.reminders) as reminder(item)
    where reminder.item ->> 'enabled' = 'true'
      and reminder.item ->> 'time' ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
      and coalesce(reminder.item ->> 'id', '') <> ''
  ),
  inactivity_candidates as (
    select
      settings.subscription_id,
      settings.user_id,
      settings.endpoint,
      settings.p256dh,
      settings.auth,
      'smart-inactivity'::text as reminder_id,
      'Come-back reminder'::text as reminder_label,
      'inactivity'::text as reminder_kind,
      'A gentle check-in from Noura'::text as notification_title,
      'It’s been ' || settings.inactivity_days || ' days since your last visit. Log what you remember when you’re ready—there is no need to catch up perfectly.' as notification_body,
      'noura-smart-inactivity-' || settings.local_date::text as notification_tag,
      ((settings.local_date + settings.inactivity_time::time) at time zone settings.timezone) as scheduled_for,
      settings.local_date
    from settings
    where settings.inactivity_enabled
      and settings.local_date - (settings.last_seen_at at time zone settings.timezone)::date >= settings.inactivity_days
      and mod(settings.local_date - (settings.last_seen_at at time zone settings.timezone)::date, settings.inactivity_days) = 0
  ),
  nutrition_totals as (
    select settings.*,
      totals.protein_total,
      totals.carbs_total,
      totals.fat_total
    from settings
    cross join lateral (
      select
        coalesce(sum(case when log.item ->> 'protein' ~ '^\d+(?:\.\d+)?$' then (log.item ->> 'protein')::numeric else 0 end), 0) as protein_total,
        coalesce(sum(case when log.item ->> 'carbs' ~ '^\d+(?:\.\d+)?$' then (log.item ->> 'carbs')::numeric else 0 end), 0) as carbs_total,
        coalesce(sum(case when log.item ->> 'fat' ~ '^\d+(?:\.\d+)?$' then (log.item ->> 'fat')::numeric else 0 end), 0) as fat_total
      from jsonb_array_elements(settings.logs) as log(item)
      where log.item ->> 'at' ~ '^\d{4}-\d{2}-\d{2}T'
        and (((log.item ->> 'at')::timestamptz at time zone settings.timezone)::date = settings.local_date)
    ) as totals
  ),
  macro_candidates as (
    select
      nutrition_totals.subscription_id,
      nutrition_totals.user_id,
      nutrition_totals.endpoint,
      nutrition_totals.p256dh,
      nutrition_totals.auth,
      'smart-macro'::text as reminder_id,
      'Macro limit alert'::text as reminder_label,
      'macro'::text as reminder_kind,
      'A quick nutrition check'::text as notification_title,
      trim(concat_ws(' ',
        case when nutrition_totals.fat_target > 0 and nutrition_totals.fat_total > nutrition_totals.fat_target * nutrition_totals.macro_threshold
          then 'Fat is ' || round(nutrition_totals.fat_total - nutrition_totals.fat_target, 1) || 'g over your target.' end,
        case when nutrition_totals.carbs_target > 0 and nutrition_totals.carbs_total > nutrition_totals.carbs_target * nutrition_totals.macro_threshold
          then 'Carbs are ' || round(nutrition_totals.carbs_total - nutrition_totals.carbs_target, 1) || 'g over your target.' end,
        case when nutrition_totals.protein_target > 0 and nutrition_totals.protein_total > nutrition_totals.protein_target * nutrition_totals.macro_threshold
          then 'Protein is ' || round(nutrition_totals.protein_total - nutrition_totals.protein_target, 1) || 'g over your target.' end,
        'Review today’s log and choose what fits your plan—no guilt, just awareness.'
      )) as notification_body,
      'noura-smart-macro-' || nutrition_totals.local_date::text as notification_tag,
      now() as scheduled_for,
      nutrition_totals.local_date
    from nutrition_totals
    where nutrition_totals.macro_enabled
      and (
        (nutrition_totals.fat_target > 0 and nutrition_totals.fat_total > nutrition_totals.fat_target * nutrition_totals.macro_threshold)
        or (nutrition_totals.carbs_target > 0 and nutrition_totals.carbs_total > nutrition_totals.carbs_target * nutrition_totals.macro_threshold)
        or (nutrition_totals.protein_target > 0 and nutrition_totals.protein_total > nutrition_totals.protein_target * nutrition_totals.macro_threshold)
      )
  ),
  due as (
    select * from meal_candidates
    where meal_candidates.scheduled_for <= now()
      and meal_candidates.scheduled_for > now() - interval '2 minutes'
    union all
    select * from inactivity_candidates
    where inactivity_candidates.scheduled_for <= now()
      and inactivity_candidates.scheduled_for > now() - interval '2 minutes'
    union all
    select * from macro_candidates
  ),
  claimed as (
    insert into public.noura_push_deliveries (
      subscription_id, user_id, reminder_id, local_date, scheduled_for
    )
    select due.subscription_id, due.user_id, due.reminder_id, due.local_date, due.scheduled_for
    from due
    on conflict (subscription_id, reminder_id, local_date) do nothing
    returning id, noura_push_deliveries.subscription_id, noura_push_deliveries.user_id,
      noura_push_deliveries.reminder_id, noura_push_deliveries.scheduled_for
  )
  select claimed.id, claimed.subscription_id, claimed.user_id, due.endpoint, due.p256dh,
    due.auth, claimed.reminder_id, due.reminder_label, due.reminder_kind,
    due.notification_title, due.notification_body, due.notification_tag, claimed.scheduled_for
  from claimed
  join due on due.subscription_id = claimed.subscription_id
    and due.user_id = claimed.user_id
    and due.reminder_id = claimed.reminder_id
    and due.scheduled_for = claimed.scheduled_for;
$$;

revoke all on function public.claim_noura_due_reminders() from public, anon, authenticated;
grant execute on function public.claim_noura_due_reminders() to service_role;
