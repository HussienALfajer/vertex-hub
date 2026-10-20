-- F16: snapshot each existing notification's priority from the catalog (rows before F16 stay
-- unresolved), and turn each saved email choice into overrides against the new defaults, so saved
-- choices are kept (spec F16, "notification_settings"). `email_types` stays until the contract
-- release drops it.
UPDATE "notifications" SET "priority" = CASE
	WHEN "type" = 'retainer_behind' AND ("data"->>'final')::boolean THEN 'critical'::notification_priority
	WHEN "type" = 'tasks_generated' AND ("data"->>'unassigned')::boolean THEN 'important'::notification_priority
	WHEN "type" IN ('task_overdue', 'task_overdue_escalated', 'task_over_limit_pending', 'post_publish_overdue', 'invoice_overdue', 'lead_follow_up_overdue') THEN 'critical'::notification_priority
	WHEN "type" IN ('task_assigned', 'task_mentioned', 'task_returned', 'task_review_requested', 'task_medical_review_requested', 'task_awaiting_client', 'task_over_limit', 'approval_responded', 'approval_no_response', 'approval_expired', 'task_requested', 'post_returned', 'post_review_requested', 'post_medical_review_requested', 'post_awaiting_client', 'post_assigned', 'post_task_unlinked', 'shoot_changed', 'meeting_changed', 'task_due_soon', 'post_publish_today', 'shoot_upcoming', 'shoot_not_closed', 'client_account_manager_assigned', 'project_manager_assigned', 'retainer_renewal_due', 'retainer_behind', 'retainer_cycle_report_ready', 'retainer_amendment_pending', 'quote_approval_requested', 'quote_approval_decided', 'ad_budget_low', 'email_failed', 'lead_assigned', 'lead_follow_up_due') THEN 'important'::notification_priority
	ELSE 'normal'::notification_priority
END;
--> statement-breakpoint
-- Types emailed by default that the user did not keep: false; types off by default they chose: true.
UPDATE "notification_settings" SET "email_overrides" = (
	SELECT coalesce(jsonb_object_agg(t, false), '{}'::jsonb)
	FROM unnest(ARRAY['task_assigned', 'task_mentioned', 'approval_responded', 'task_due_soon', 'task_overdue', 'task_overdue_escalated', 'task_over_limit_pending', 'post_publish_overdue', 'invoice_overdue', 'invoice_paid', 'lead_follow_up_overdue']) AS t
	WHERE t <> ALL ("email_types"::text[])
) || (
	SELECT coalesce(jsonb_object_agg(t, true), '{}'::jsonb)
	FROM unnest(ARRAY['task_returned', 'task_review_requested', 'task_medical_review_requested', 'task_awaiting_client', 'task_over_limit', 'approval_no_response', 'approval_expired', 'task_changed', 'task_commented', 'task_file_added', 'task_requested', 'tasks_generated', 'task_approved', 'task_opened', 'request_finished', 'post_returned', 'post_review_requested', 'post_medical_review_requested', 'post_awaiting_client', 'post_assigned', 'post_approved', 'post_task_ready', 'post_task_unlinked', 'shoot_booked', 'shoot_dropped', 'shoot_changed', 'meeting_invited', 'meeting_dropped', 'meeting_changed', 'post_publish_today', 'shoot_upcoming', 'shoot_not_closed', 'meeting_upcoming', 'client_account_manager_assigned', 'project_manager_assigned', 'retainer_renewal_due', 'retainer_behind', 'retainer_term_renewed', 'retainer_cycle_report_ready', 'retainer_amendment_pending', 'retainer_amendment_decided', 'quote_approval_requested', 'quote_approval_decided', 'quote_accepted', 'ad_budget_low', 'email_failed', 'lead_assigned', 'lead_won', 'lead_follow_up_due']) AS t
	WHERE t = ANY ("email_types"::text[])
)
WHERE "email_types" IS NOT NULL;
