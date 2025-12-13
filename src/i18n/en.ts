// English translations
import type { Translations } from "./ru";

const en: Translations = {
  // Language selection
  lang_select: "Choose language:",
  lang_changed: "Language changed",
  // Commands
  cmd_start_welcome: `Hi! I'll help you find listings in Telegram groups.

📌 Example searches:

🏠 Housing — "Apartment for rent, €500, city center"
🛒 Shopping — "Selling iPhone 14 Pro"
💼 Jobs — "Hiring frontend developer"
🔧 Services — "Appliance repair services"

Describe as the person posting — what does the post you need look like?`,
  cmd_help: `Commands:
/start — start
/list — my subscriptions
/lang — change language
/settings — settings
/premium — pricing`,

  // Subscription flow
  sub_generating_keywords: "Generating keywords...",
  sub_no_examples: "No examples found, generating keywords...",
  sub_confirm_or_cancel: "Confirm or cancel:",
  sub_confirm_or_adjust: "Confirm or adjust parameters:",
  sub_select_groups: "Select groups to monitor:",
  sub_created: "Subscription created!",
  sub_paused: "Subscription paused",
  sub_resumed: "Subscription resumed",
  sub_not_found: "Subscription not found",
  sub_session_expired: "Session expired. Send a new query.",

  // Keyboards - common
  kb_confirm: "Confirm",
  kb_cancel: "Cancel",
  kb_back: "Back",
  kb_skip: "Skip",
  kb_skip_arrow: "Skip →",
  kb_done: "Done",
  kb_done_count: "Done ({n})",
  kb_add: "Add",
  kb_remove: "Remove",
  kb_change: "Change",
  kb_yes: "Yes",
  kb_no: "No",

  // Keyboards - groups
  kb_select_group: "Select group",
  kb_select_channel: "Select channel",
  kb_select_all: "Select all",
  kb_deselect_all: "Deselect all",
  kb_add_group: "Add group",
  kb_select_manual: "Select groups manually",

  // Keyboards - subscription
  kb_adjust_ai: "🤖 Adjust",
  kb_add_words: "✏️ + words",
  kb_remove_words: "✏️ − words",
  kb_edit_description: "✏️ Description",
  kb_disable_negative: "🚫 Disable excl.",
  kb_enable_negative: "✅ Enable excl.",
  kb_show_keywords: "🔑 Keywords",
  kb_pause: "⏸️ Pause",
  kb_resume: "▶️ Resume",
  kb_adjust_ai_full: "🤖 Adjust with AI",
  kb_delete: "❌ Delete",

  // Keyboards - AI edit
  kb_apply: "Apply",
  kb_apply_check: "✅ Apply",
  kb_manual_ai_edit: "Bad, I'll adjust myself (with AI)",

  // Keyboards - rating
  kb_rate_hot: "🔥 Hot",
  kb_rate_warm: "☀️ Warm",
  kb_rate_cold: "❄️ Cold",
  kb_skip_rating: "Skip ({n}/{total})",

  // Keyboards - settings
  kb_mode_normal: "📊 Normal mode",
  kb_mode_advanced: "🔬 Advanced",

  // Keyboards - forward analysis
  kb_remove_keyword: "🗑 Remove \"{kw}\"",
  kb_expand: "🔧 Expand",
  kb_with_ai: "✏️ With AI",
  kb_analyze: "🔍 Analyze",

  // Keyboards - metadata
  kb_not_this_time: "Not this time",

  // Keyboards - premium
  kb_analyze_free: "🔍 Analyze",
  kb_analyze_price: "🔍 Analyze — {n}⭐",
  kb_miss: "👎 Miss",

  // Keyboards - premium plans
  kb_plan_basic: "Basic — 50⭐/mo",
  kb_plan_pro: "Pro — 150⭐/mo",
  kb_plan_business: "Business — 500⭐/mo",

  // Keyboards - promotion
  kb_promote_admin: "🚀 Promote (admin)",
  kb_promote_price: "🚀 Promote — {n}⭐",
  kb_promote_group_admin: "🚀 Promote group (admin)",
  kb_promote_group_price: "🚀 Promote group — {n}⭐",
  kb_days_price: "{days} — {price}⭐",

  // Keyboards - presets
  kb_access_active: "✅ Access active",
  kb_buy_lifetime: "🔓 Forever — {n}⭐",
  kb_buy_month: "📅 Monthly — {n}⭐",
  kb_other_region: "🌍 Other",

  // Keyboards - publish
  kb_create_publication: "📝 Create listing",
  kb_my_publications: "📋 My publications",
  kb_disconnect: "🔌 Disconnect account",
  kb_connect_telegram: "🔗 Connect Telegram",
  kb_publish_price: "✅ Publish — {n}⭐",
  kb_use_free_pub: "🎁 Use free publication",

  // Notifications
  notif_delayed: "This notification was delayed by {minutes} min. Get instant with Basic!",

  // Errors
  // Plurals (format: one|other)
  groups_count: "{n} group|{n} groups",
  messages_count: "{n} message|{n} messages",
  // Recovery
  // Payments
  // Misc
  yes: "Yes",
  no: "No",

  // Analysis results
  analysis_result: "Analysis result:",
  analysis_what_looking: "What we're looking for:",
  analysis_positive_kw: "Positive keywords:",
  analysis_negative_kw: "Negative keywords:",
  analysis_none: "none",
  analysis_description: "Description for verification:",
  analysis_analyzing: "Analyzing query...",
  analysis_generating_with_ratings: "Generating keywords based on your ratings...",

  // Commands extended
  // List command
  list_no_subscriptions: "You don't have any subscriptions yet. Describe what you're looking for.",
  list_sub_header: "Subscription #{id}{pause}",
  list_sub_header_paused: "Subscription #{id} ⏸️",
  list_query: "Query:",
  list_keywords: "Keywords:",
  list_exclusions: "Exclusions:",
  list_llm_description: "LLM Description:",
  list_description: "Description:",
  list_exclusions_disabled: "Exclusions disabled",
  list_exclusions_enabled: "Exclusions enabled",
  list_exclusions_disabled_list: "(disabled: {list})",

  // Settings
  settings_title: "Settings",
  settings_current_mode: "Current mode:",
  settings_mode_normal: "📊 Normal",
  settings_mode_advanced: "🔬 Advanced",
  settings_normal_desc: "In normal mode, the bot doesn't show keywords or ask clarifying questions.",
  settings_advanced_desc: "In advanced mode, you see keywords, can edit them, and answer clarifying questions.",
  settings_mode_changed: "Mode changed",

  // Presets
  presets_not_configured: "Region presets are not configured yet.",
  presets_intro: "A preset is a collection of all marketplace groups in a region.\nBuy a preset and add all groups from a region to your subscription with one click.\n\nSelect a region:",
  presets_select_region: "Select region",
  presets_region_explanation: "This is needed to show group presets when creating a subscription.",

  // Catalog
  catalog_open: "Open the product catalog:",
  catalog_button: "Open catalog",

  // Groups
  groups_select_add: "Select a group or channel to add:",
  groups_none: "You don't have any groups added. Use /addgroup to add.",
  groups_list_header: "Your groups for monitoring:",
  groups_already_added: "This group is already added!",
  groups_error_already_added: "Already added",
  groups_private_need_link: "Private group \"{title}\".\n\nBot cannot join without invite link.\nSend a link like t.me/+XXX or click Skip.",
  groups_select_more: "Select another group or click \"Done\":",
  groups_not_added: "No groups added. Use /addgroup when ready.",
  groups_added_processing: "{n} group added. Processing your request...|{n} groups added. Processing your request...",
  groups_added_ready: "{n} group added. Now describe what you want to monitor.|{n} groups added. Now describe what you want to monitor.",
  groups_joining: "Link received, trying to join...",
  groups_invalid_format: "Invalid format. Send a link like t.me/+XXX or click Skip.",
  groups_skipped: "Group skipped.",
  groups_select_for_monitoring: "Select groups to monitor:",
  groups_selected_count: "Selected: {selected} of {total}",
  groups_adding: "Adding group...",

  // Subscription limits
  sub_limit_reached: "⚠️ Subscription limit reached",
  sub_limit_your_plan: "Your plan: {plan}",
  sub_limit_subs_count: "Subscriptions: {current}/{max}",
  sub_limit_upgrade_prompt: "To create more subscriptions, upgrade to the next plan.",
  sub_limit_upgrade_button: "Upgrade to {plan} — {price}⭐/mo",

  // Keywords editing
  kw_need_words: "Need at least one word.",
  kw_description_short: "Description is too short.",
  kw_positive: "Positive:",
  kw_negative: "Negative:",
  kw_added_full: "✅ Added: {added}",
  kw_send_numbers: "Send word numbers separated by comma (e.g., 1, 3)",
  kw_invalid_numbers: "Invalid numbers.",
  kw_cant_delete_all: "Can't delete all positive words.",
  kw_word_not_found: "Word not found",
  kw_cant_delete_last: "Can't delete the last word",
  kw_word_deleted: "Word deleted",
  kw_added: "✅ Added: {added}\nCurrent: {current}",
  kw_description_updated: "✅ Description updated",
  kw_no_words_to_delete: "No words to delete",
  kw_select_words: "Select words",
  // AI edit
  ai_correcting: "Adjusting (may take up to a minute)...",
  ai_changes: "Changes:",
  ai_no_changes: "No changes",
  ai_comment: "AI:",
  ai_example_messages: "Example messages:",
  ai_error: "Processing error. Try rephrasing.",
  ai_new_description: "New description:",
  ai_edit_mode: "AI Editing Mode",
  ai_current_params: "Current parameters:",
  ai_words: "- words:",
  ai_edit_examples: `Examples:
• "add word rental"
• "remove word sale"
• "add office to exclusions"
• "change description to ..."`,
  ai_describe_changes: "Describe what to change",
  ai_edit_short_examples: `Examples:
• "add word rental"
• "remove word sale"
• "add office to exclusions"`,
  ai_clarify_query: "Clarify query",
  ai_current_description: "Current description:",
  ai_clarify_examples: `Examples:
• "looking for new only, not used"
• "no services, only products"
• "add that delivery is needed"`,
  ai_correction_mode_full: "AI Correction Mode",
  ai_applied: "Applied!",
  ai_cancelled_full: "Editing cancelled.",
  ai_generating: "Generating...",
  ai_generation_error: "Generation error. Try later.",
  ai_changes_applied: "✅ Changes applied.",
  ai_regenerated_keywords: "Regenerated keywords:",
  ai_plus_words: "+ words:",
  ai_corrected_keywords: "Adjusted keywords:",
  ai_confirm_or_change: "Confirm or change:",
  ai_continue_or_apply: "You can continue editing or apply:",
  ai_keywords_auto_regen: "Keywords will be regenerated automatically.\nYou can continue refining or apply:",

  // Clarification questions
  clarify_question: "Clarifying question",
  clarify_generating: "Generating clarifying questions...",
  clarify_failed: "Failed to generate questions, moving to examples...",
  clarify_default: "What specific characteristics are important?",
  clarify_analyzing: "Analyzing answers...",
  clarify_skipped: "Skipped",
  clarify_skipping: "Skipping...",
  clarify_examples_skipped: "Examples skipped.",

  // Forward analysis
  forward_no_text: "Message contains no text.",
  forward_not_seen: "Bot hasn't seen this message in monitored groups.",
  forward_not_analyzed: "Message hasn't been analyzed yet.",
  forward_not_analyzed_group: "Message from \"{title}\" hasn't been analyzed yet.",
  forward_group_not_monitored: "This message's group is not in your monitoring.",
  forward_group_unknown: "Unknown",
  forward_group_not_added: "Group \"{title}\" is not added to monitoring.",
  forward_cant_determine_source: "Can't determine message source.",
  forward_unknown_group: "Unknown group",
  forward_unknown_sender: "Unknown",
  forward_sent_at: "Sent {date}",
  forward_match_found: "Match found",

  // Rejection reasons
  reject_negative_kw: "Contains exclusion keyword \"{keyword}\"",
  reject_ngram: "Text is far from query (similarity {score}%)",
  reject_semantic_kw: "Blocked by semantic filter: \"{keyword}\"",
  reject_semantic: "Semantics didn't match ({score}%)",
  reject_llm_reason: "AI rejected: {reason}",
  reject_llm_confidence: "AI didn't confirm match (confidence {score}%)",
  reject_llm: "AI didn't confirm match",
  reject_matched: "Message matches criteria",
  reject_unknown: "Reason not determined",

  // Status texts
  status_matched: "Matched",
  status_excluded: "Excluded",
  status_ngram: "No match",
  status_semantic: "Semantics",
  status_llm: "AI rejected",
  status_unknown: "Unknown",

  // Date formatting
  date_unknown: "unknown",
  date_today: "today at {time}",
  date_yesterday: "yesterday",
  date_days_ago: "{days} days ago",

  // Detailed analysis
  analysis_semantic: "Semantics: {score}%",
  analysis_scores: "Scores: {scores}",

  forward_analyzing: "Analyzing...",
  forward_no_subscriptions: "You have no active subscriptions for analysis.",
  forward_no_matching_subs: "No subscriptions to analyze this message.",
  forward_results: "Analysis results:",
  forward_text_not_found: "Message text not found",
  forward_expanding: "Expanding criteria...",
  forward_expanding_progress: "⏳ Extracting keywords and updating subscription...",
  forward_expand_success: "✅ Criteria expanded!\n\nAdded words: {words}",
  forward_expand_failed: "Failed to extract keywords from message.",
  forward_expand_error: "Error expanding criteria. Try later.",
  forward_ai_correction: "AI correction",

  // Miss analysis
  miss_title: "Miss!",
  miss_analyzing: "Analyzing message...",
  miss_suggestion: "Suggestion:",

  // Callbacks common
  cb_session_expired: "Session expired",
  cb_subscription_created: "Subscription created",
  cb_select_groups: "Select groups",
  cb_select_action: "Select action",
  cb_send_words: "Send words",
  cb_cancelled: "Cancelled",
  // Subscription callbacks
  sub_disabled: "Subscription disabled",
  sub_no_groups_created: "Subscription created!\n\nYou have no groups added. Use /addgroup to add.",
  sub_need_groups_first: "First, you need to add at least one group to monitor.\n\nSelect a group:",

  // Rating
  rating_example_title: "Example {index}/{total}",
  rating_is_this_match: "Does this match what you're looking for?",
  rating_moving_next: "Moving to next...",
  rating_all_done: "All examples rated!",
  rating_intro: `📝 I'll show you examples — rate them to help me understand what you're looking for.

The bot uses AI, keywords and semantic analysis — it finds posts with typos, in different languages, phrased differently, and even analyzes images when text isn't clear.`,

  // Feedback
  feedback_outcome_bought: "Bought",
  feedback_outcome_not_bought: "Didn't buy",
  feedback_outcome_complicated: "It's complicated",
  feedback_review_prompt: "Thanks for your answer!\n\nLeave a review message (what you liked, what can be improved):",
  feedback_thanks: "Thanks!",
  feedback_thanks_full: "Thanks for the feedback!",

  // Payment errors
  pay_invalid_plan: "Invalid plan",
  pay_creating_link: "Creating payment link...",
  pay_link_error: "Error creating payment link. Try later.",
  pay_creating_invoice: "Creating invoice...",
  pay_invoice_error: "Error creating invoice. Try later.",
  pay_user_not_found: "User not found",
  pay_verification_error: "Payment verification error",
  pay_preset_not_found: "Preset not found",
  pay_processing_error: "Payment processing error",
  pay_unknown_type: "Unknown payment type",
  pay_preset_missing: "Preset not specified",
  pay_group_missing: "Group not specified",
  pay_product_missing: "Product not specified",
  pay_publication_missing: "Publication not specified",

  // Payment success messages
  pay_sub_activated: "✅ {plan} subscription activated until {date}",
  pay_analyze_started: "✅ Payment accepted, starting analysis...",
  pay_preset_access_lifetime: "✅ Access to preset \"{name}\" activated forever",
  pay_preset_access_month: "✅ Access to preset \"{name}\" activated for 30 days",
  pay_group_promo_activated: "✅ Group promotion activated for {days} days",
  pay_product_promo_activated: "✅ Product promotion activated for {days} days",
  pay_publication_started: "✅ Payment accepted! Starting publication now...",

  // Plan descriptions
  plan_basic_desc: "10 subscriptions, 20 groups, priority pushes",
  plan_pro_desc: "50 subscriptions, unlimited groups, fora, 50% analysis discount",
  plan_business_desc: "Unlimited everything, free analysis",
  plan_subscription_title: "{plan} Subscription",
  plan_label: "{plan} plan",

  // Plan info
  plan_info_title: "💎 Your plan: {plan}\n\n",
  plan_info_limits: "Limits:\n",
  plan_info_subs: "• Subscriptions: {current}/{max}\n",
  plan_info_groups: "• Groups per subscription: {max}\n",
  plan_info_free_analyzes: "• Free analyzes: {used}/1 (per 6 months)\n",
  plan_info_priority: "• ⚡ Priority pushes\n",
  plan_info_fora: "• 👥 See how many people search for the same\n",
  plan_info_free_analysis: "• 🔍 Free product analysis\n",
  plan_info_discount_analysis: "• 🔍 Analysis with 50% discount ({price}⭐)\n",
  plan_info_expires: "\n📅 Valid until: {date}",

  // Presets callbacks
  preset_not_found: "Preset not found",
  preset_selected: "Preset selected",
  preset_deselected: "Preset deselected",
  preset_no_groups: "No groups from this preset",
  preset_all_selected: "All selected",
  preset_all_deselected: "All deselected",

  // Promotion
  promo_only_own_posts: "You can only promote your own posts",
  promo_only_admin_groups: "You can only promote groups where you're an admin",
  promo_already_promoted: "Group is already being promoted",
  promo_cancelled: "Promotion cancelled.",
  promo_not_found: "Promotion not found",
  promo_opening_payment: "Opening payment...",
  promo_product_desc: "Product will rank higher in WebApp search",
  promo_group_desc: "Group will be recommended to users",

  // Analysis payment
  analysis_title: "Listing Analysis",
  analysis_desc: "Full analysis: market prices, scam check, similar products",
  analysis_error: "Analysis error. Try later.",
  analysis_data_not_found: "Data not found",
  analysis_message_not_found: "Message not found in database",
  analysis_no_original: "Original message not found",

  // Generic
  error: "Error",
  error_data: "Data error",
  selected: "Selected",
  deselected: "Deselected",
  already_selected: "Already selected",

  // Additional callbacks
  sub_paused_list: "Subscription paused. /list to resume.",
  sub_disabled_ask_feedback: "Subscription disabled.\n\nDid the deal work out?",
  sub_created_no_groups: "Subscription created! No groups selected, monitoring all available.",
  cancel_send_new_query: "Cancelled. Send a new query when ready.",
  unknown_query: "Unknown query",
  example_deleted: " (deleted)",
  example_generated: "🤖 Generated example",
  kw_added_current: "✅ Added: {added}\nCurrent: {current}",
  kw_removed_remaining: "✅ Removed: {removed}\nRemaining: {remaining}",
  kw_removed_all: "✅ Removed: {removed}",
  kw_positive_label: "Positive",
  kw_negative_label: "Negative",
  kw_words_list: "{label} words:\n{list}\n\nClick a word or send numbers comma-separated:",
  kw_current_send_add: "Current: {current}\n\nSend words to add comma-separated:",
  kw_current_description: "Current description:\n{desc}\n\nSend new description for LLM verification:",
  ai_send_description: "Send new description",
  ai_edit_mode_short: "Edit mode",
  ai_describe_changes_short: "Describe changes",
  ai_correction_mode_short: "Correction mode",

  // Diff text
  diff_added: "+ Added: {list}",
  diff_removed: "- Removed: {list}",
  diff_added_exclusions: "+ Exclusions: {list}",
  diff_removed_exclusions: "- From exclusions: {list}",
  diff_description: "Description: {desc}",

  // Subscription created messages
  sub_created_scanning: "Subscription created! Monitoring groups: {groups}\n\n⏳ Scanning message history...",
  sub_created_found: "✅ Subscription created! Monitoring groups: {groups}\n\n📬 Found {count} in history.",
  sub_created_sent_partial: "\n\n📤 Sent first 5 of {total}. Others will appear in feed with new matches.",
  sub_created_not_found: "✅ Subscription created! Monitoring groups: {groups}\n\n📭 No matches found in history.",
  sub_created_scan_error: "✅ Subscription created! Monitoring groups: {groups}\n\n⚠️ History scan error.",

  // Notification keyboard
  notif_go_to_post: "📎 Go to post",
  notif_analyze: "🔍 Analyze",
  notif_analyze_free: "🔍 Analyze (1 free)",
  notif_analyze_price: "🔍 Analyze — {price}⭐",
  notif_miss: "👎 Miss",
  notif_pause_sub: "⏸️ Stop subscription",
  notif_promote: "🚀 Promote",
  notif_already_promoted: "✅ Already promoted",

  // Rating marked
  rating_marked_relevant: "🔥 You marked as relevant",
  rating_recorded: "Recorded",

  // Admin feedback
  admin_feedback_bought: "✅ Bought",
  admin_feedback_not_bought: "❌ Didn't buy",
  admin_feedback_complicated: "🤷 It's complicated",
  admin_feedback_from: "📝 Feedback from {user}:\n{outcome}\n\nQuery: {query}\n\nReview: {review}",

  // Group add
  group_adding_count: "Adding {count}...",
  group_added_success: "{icon} \"{title}\" added!",
  group_add_failed: "Failed to add \"{title}\": {error}",
  group_pending_approval: "⏳ Join request for \"{title}\" sent. Waiting for admin approval.",
  error_no_username_or_invite: "No username. Use /addgroup invite_link",

  // Keyword editing for pending subscription
  kw_pending_positive: "Positive words: {list}\n\nWhat to do?",
  kw_pending_negative: "Negative words: {list}\n\nWhat to do?",
  kw_answer_removed: "Removed: {removed}",
  kw_select_words_numbered: "{label} words:\n{list}\n\nClick a word or send numbers comma-separated:",
  kw_deleted: "✅ Deleted: {list}",

  // Miss analysis
  miss_no_changes: "No changes",
  miss_clarify_or_apply: "You can clarify or apply:",
  miss_error_describe: "Analysis error. Describe in your own words what to change in subscription \"{query}\":",
  miss_text_unavailable: "[text unavailable]",
  miss_context: "This message was shown but it's a miss:\n\"{text}\"\n\nSuggest how to change the subscription so such messages don't appear.",

  // Group quick add
  group_unknown: "Unknown group",
  group_adding_progress: "⏳ Adding group \"{title}\"...",
  group_cant_read: "Bot can't read this group. Use /addgroup and send an invite link.",
  group_added_to_monitoring: "✅ Group \"{title}\" added to monitoring.",
  group_add_use_addgroup: "Failed to add group. Use /addgroup.",

  // Presets detailed
  preset_title: "🗺️ **Region Presets**\n\nA preset is a collection of all marketplace groups in a region.\nBuy a preset and add all region groups to your subscription with one click.\n\nChoose a region:",
  preset_country: "📍 Country: {value}",
  preset_currency: "💱 Currency: {value}",
  preset_groups_count: "👥 Groups in preset: {count}",
  preset_has_access: "✅ You have access to this preset",
  preset_need_buy: "🔒 Purchase required for access",
  preset_buy_title: "Preset: {name}",
  preset_buy_desc_lifetime: "Lifetime access to {count} groups",
  preset_buy_desc_month: "30-day access to {count} groups",
  preset_region_saved: "Region saved: {name}",
  preset_region: "Region: {name}",

  // Promotion detailed
  promo_already_until: "Already promoted until {date}",
  promo_status: "Promoted until {date} ({days} days)",
  promo_product_title: "Product promotion ({days} days)",
  promo_group_title_days: "Group promotion ({days} days)",
  promo_product_full: "🚀 **Product Promotion**\n\nChoose promotion duration:\n• Product will rank higher in WebApp search\n• Shown while waiting for analysis",
  promo_group_full: "🚀 **Group Promotion**\n\nChoose promotion duration:\n• Group will be recommended to users",

  // Premium
  premium_select_plan: "💎 {plan} subscription\n\nClick the button below to pay:",
  premium_pay_button: "Pay {plan}",
  premium_back: "← Back",

  // Analysis (product)
  analysis_product_analyzing: "⏳ Analyzing listing...\nThis may take 10-30 seconds.",

  // Waiting message
  waiting_promo: "📢 While waiting:\n\n",

  // AI edit for existing subscription
  ai_edit_existing_prompt: "Describe how to change search criteria for subscription \"{query}\".\n\nExample: \"add words about discounts\" or \"remove too strict filters\"",
  ai_keyword_removed: "✅ Word \"{keyword}\" removed from exclusions.\n\nSubscription: \"{query}\"\nExclusion words: {remaining}",

  // Notification format
  notif_group: "Group: {title}",
  notif_group_link: "Group: [{title}](https://t.me/{username})",
  notif_competitors: "\n👥 ~{count} people are also looking for this",
  notif_reason: "💡 Reason: {reason}",

  // Publish flow
  pub_disabled: "⚠️ Publishing temporarily unavailable. Contact administrator.",
  pub_title: "📢 **Publish Listings**",
  pub_intro: "Publish listings to all marketplace groups in a region with one click!",
  pub_connected: "✅ Your Telegram account is connected",
  pub_need_connect: "To publish, you need to connect your Telegram account. Listings will be sent from your account.",
  pub_price: "Price: {price}⭐ per publication to all preset groups",
  pub_connect_title: "🔗 *Connect Telegram*",
  pub_connect_intro: "To publish listings, you need to authorize your Telegram account.",
  pub_send_phone: "📱 Send your phone number in format:\n+79001234567",
  pub_invalid_phone: "❌ Invalid format. Send number with country code, e.g.: +79001234567",
  pub_error: "❌ Error: {error}",
  pub_error_retry: "❌ Error: {error}\n\nTry again with /publish",
  pub_code_sent: "📨 Code sent to Telegram!\n\nEnter the code:",
  pub_enter_2fa: "🔐 Enter two-factor authentication password:",
  pub_connected_success: "✅ **Account connected!**\n\nNow you can publish listings to marketplaces.",
  pub_text_saved: "✅ Text saved",
  pub_text_saved_photos: "✅ Text saved (+ {count} photos)",
  pub_add_more: "You can add more text or photos, or click «Done» to proceed to confirmation.",
  pub_max_photos: "❌ Maximum 10 photos. Delete extras or click «Done».",
  pub_photo_added: "📷 Photo added ({current}/10)",
  pub_photo_added_text: "📷 Photo added ({current}/10) + text saved",
  pub_add_text_reminder: "\n\nDon't forget to add listing text!",
  pub_no_active: "❌ No active listing. Start with /publish",
  pub_need_text: "❌ Add listing text!",
  pub_create_error: "❌ Error creating publication. Try later.",
  pub_review_title: "📋 *Review listing before publishing*",
  pub_review_photos: "📷 *Photos:* {count}",
  pub_review_dest: "*To:* {preset} ({groups} groups)",
  pub_review_price: "*Price:* {price}⭐",
  pub_how_it_works_title: "🤖 *How publishing works:*",
  pub_how_it_works: "After payment, the bot will for each group:\n1. Generate a unique version of text via AI (to not look like spam)\n2. Show you for review\n3. Send only after your confirmation\n\nYou can edit or skip any group.",
  pub_free_credits: "🎁 You have *{count}* free publications!",
  pub_daily_limit: "❌ Daily publication limit reached (10). Try tomorrow.",
  pub_no_presets: "❌ No available presets with groups.",
  pub_select_region: "📝 *Create Listing*\n\nSelect region for publishing:",
  pub_create_title: "📝 *Create Listing*",
  pub_create_region: "*Region:* {region}",
  pub_create_instructions: "Send:\n• Listing text (description, price, contacts)\n• Photos (up to 10)\n\nYou can send text first, then photos — or vice versa.\n\nWhen done — click ✅ *Done*",
  pub_invoice_title: "Listing Publication",
  pub_invoice_desc: "Publication to all preset groups",
  pub_not_found: "❌ Publication not found.",
  pub_no_credits: "❌ You have no free publications.",
  pub_credit_used: "🎁 Free publication activated!",
  pub_no_publications: "📋 You don't have any publications yet.",
  pub_status_pending: "⏳ Pending",
  pub_status_processing: "🔄 Publishing",
  pub_status_completed: "✅ Done",
  pub_status_failed: "❌ Failed",
  pub_status_cancelled: "🚫 Cancelled",
  pub_my_title: "📋 *My Publications*",
  pub_disconnected: "✅ Account disconnected. To publish, connect it again.",
  pub_cancelled: "Cancelled.",
  pub_publication_cancelled: "Publication cancelled.",
  pub_unknown_region: "Unknown region",
  pub_region: "Region",

  // Recovery
  recovery_resuming: "⏳ Bot was restarted, resuming operation...",
  recovery_keywords_restored: "⏳ Bot was restarted. Keywords restored:",
  recovery_positive: "🔍 Positive: {keywords}",
  recovery_negative: "🚫 Negative: {keywords}",
  recovery_confirm: "Confirm or adjust:",
  recovery_ai_correct_failed: "❌ Failed to restore AI correction. Try again.",
  recovery_ai_correct_restored: "✅ AI correction restored:",
  recovery_ai_correct_apply: "Send \"apply\" to use these keywords, or describe other changes.",
  recovery_ai_edit_failed: "❌ Failed to restore AI editing. Try again.",
  recovery_ai_edit_restored: "✅ AI editing restored:",
  recovery_ai_edit_apply: "Send \"apply\" to save changes.",
  recovery_query_lost: "⚠️ Bot was restarted during query analysis.\nSend your query again to start over.",
  recovery_clarify_continue: "⏳ Bot was restarted. Continuing:",
  recovery_clarify_question: "**Clarifying question** ({current}/{total})",
  recovery_examples_restart: "⏳ Bot was restarted. Continuing with examples.\nUse /start to start over.",
  recovery_session_failed: "❌ Failed to restore session after restart.\nSend your query again.",
  recovery_examples_lost: "⚠️ Bot was restarted during example generation.\nSend your query again.",
  recovery_examples_skipped: "⏳ Bot was restarted. Skipping examples, keywords ready:",

  // Deep analysis plurals (format: one|other)

  // Referrals
  referral_new_user: "🎉 New user joined via your link: {name}",
  referral_title: "🔗 *Referral Program*",
  referral_link: "Your link: `{link}`",
  referral_balance: "💰 Bonus balance: {amount}⭐",
  referral_stats: "👥 Referred: {count} | Earned: {total}⭐",
  referral_info: "Invite friends and earn 10% from their purchases!",
  referral_earned: "🎁 You earned {amount}⭐ bonus from {name}'s purchase!",
  bonus_applied: "✅ Used {amount}⭐ bonus",
  bonus_offer: "💰 You have {balance}⭐ bonus. Use it?",
  bonus_use_full: "Use {amount}⭐ (free)",
  bonus_use_partial: "Use {bonus}⭐ (pay {remaining}⭐)",
  bonus_skip: "Don't use bonus",

  // Tips (shown during LLM processing)
  tip_header: "💡 Tip while you wait:",
  tip_referral: "Invite friends and earn 10% from their purchases! /referral",
  tip_plans: "On Pro plan, analysis costs only 10⭐ instead of 20⭐",
  tip_usecase_rare: "Bot is great for finding rare items — monitors groups 24/7",
  tip_usecase_price: "Track prices: create a subscription for 'iPhone under €300'",

  // Region selection (new users)
  region_select_prompt: "🗺️ Select your region:",
  region_belgrade: "🏙️ Belgrade",
  region_novi_sad: "🏙️ Novi Sad",
  region_other: "🌍 Other region",
  region_saved_with_presets: "✅ Region saved!\n\nHere are groups for your region. Use /addgroup if you want to add groups the bot doesn't know yet.",
  region_other_addgroup: "✅ Region saved!\n\nUse /addgroup to add groups for monitoring.",
  region_mention_addgroup: "💡 Use /addgroup if you want to add more groups.",

  // Admin webapp
  adminPresets: "Presets",
};

export default en;
