// Serbian (Latin) translations
import type { Translations } from "./ru";

const rs: Translations = {
  // Language selection
  lang_select: "Izaberi jezik:",
  lang_changed: "Jezik je promenjen",
  // Commands
  cmd_start_welcome: `Zdravo! Pomoći ću ti da pronađeš oglase u Telegram grupama.

Koje objave hvatati? Opiši kao da si korisnik koji objavljuje u grupi.`,
  cmd_help: `Komande:
/start — početak
/list — moje pretplate
/lang — promeni jezik
/settings — podešavanja
/premium — cenovnik`,

  // Subscription flow
  sub_generating_keywords: "Generišem ključne reči...",
  sub_no_examples: "Primeri nisu pronađeni, generišem ključne reči...",
  sub_confirm_or_cancel: "Potvrdi ili otkaži:",
  sub_confirm_or_adjust: "Potvrdi ili izmeni parametre:",
  sub_select_groups: "Izaberi grupe za praćenje:",
  sub_created: "Pretplata je kreirana!",
  sub_paused: "Pretplata je pauzirana",
  sub_resumed: "Pretplata je nastavljena",
  sub_not_found: "Pretplata nije pronađena",
  sub_session_expired: "Sesija je istekla. Pošalji novi upit.",

  // Keyboards - common
  kb_confirm: "Potvrdi",
  kb_cancel: "Otkaži",
  kb_back: "Nazad",
  kb_skip: "Preskoči",
  kb_skip_arrow: "Preskoči →",
  kb_done: "Gotovo",
  kb_done_count: "Gotovo ({n})",
  kb_add: "Dodaj",
  kb_remove: "Obriši",
  kb_change: "Promeni",
  kb_yes: "Da",
  kb_no: "Ne",

  // Keyboards - groups
  kb_select_group: "Izaberi grupu",
  kb_select_channel: "Izaberi kanal",
  kb_select_all: "Izaberi sve",
  kb_deselect_all: "Poništi sve",
  kb_add_group: "Dodaj grupu",
  kb_select_manual: "Izaberi grupe ručno",

  // Keyboards - subscription
  kb_adjust_ai: "🤖 Koriguj",
  kb_add_words: "✏️ + reči",
  kb_remove_words: "✏️ − reči",
  kb_edit_description: "✏️ Opis",
  kb_disable_negative: "🚫 Isključi izuz.",
  kb_enable_negative: "✅ Uključi izuz.",
  kb_show_keywords: "🔑 Ključne reči",
  kb_pause: "⏸️ Pauza",
  kb_resume: "▶️ Nastavi",
  kb_adjust_ai_full: "🤖 Koriguj sa AI",
  kb_delete: "❌ Obriši",

  // Keyboards - AI edit
  kb_apply: "Primeni",
  kb_apply_check: "✅ Primeni",
  kb_manual_ai_edit: "Loše, korigovaću sam (sa AI)",

  // Keyboards - rating
  kb_rate_hot: "🔥 Vruće",
  kb_rate_warm: "☀️ Toplo",
  kb_rate_cold: "❄️ Hladno",
  kb_skip_rating: "Preskoči ({n}/{total})",

  // Keyboards - settings
  kb_mode_normal: "📊 Normalni režim",
  kb_mode_advanced: "🔬 Napredni",

  // Keyboards - forward analysis
  kb_remove_keyword: "🗑 Ukloni \"{kw}\"",
  kb_expand: "🔧 Proširi",
  kb_with_ai: "✏️ Sa AI",
  kb_analyze: "🔍 Analiziraj",

  // Keyboards - metadata
  kb_not_this_time: "Ne ovog puta",

  // Keyboards - premium
  kb_analyze_free: "🔍 Analiza",
  kb_analyze_price: "🔍 Analiza — {n}⭐",
  kb_miss: "👎 Promašaj",

  // Keyboards - promotion
  kb_promote_admin: "🚀 Promoviši (admin)",
  kb_promote_price: "🚀 Promoviši — {n}⭐",
  kb_promote_group_admin: "🚀 Promoviši grupu (admin)",
  kb_promote_group_price: "🚀 Promoviši grupu — {n}⭐",
  kb_days_price: "{days} — {price}⭐",

  // Keyboards - presets
  kb_access_active: "✅ Pristup aktivan",
  kb_buy_lifetime: "🔓 Zauvek — {n}⭐",
  kb_buy_month: "📅 Mesečno — {n}⭐",
  kb_other_region: "🌍 Drugi",

  // Keyboards - publish
  kb_create_publication: "📝 Kreiraj oglas",
  kb_my_publications: "📋 Moje publikacije",
  kb_disconnect: "🔌 Odspoji nalog",
  kb_connect_telegram: "🔗 Poveži Telegram",
  kb_publish_price: "✅ Objavi — {n}⭐",
  kb_use_free_pub: "🎁 Koristi besplatnu publikaciju",

  // Notifications
  notif_delayed: "Ovo obaveštenje je kasnilo {minutes} min. Dobij trenutno sa Basic!",

  // Errors
  // Plurals (format: one|few|many)
  groups_count: "{n} grupa|{n} grupe|{n} grupa",
  messages_count: "{n} poruka|{n} poruke|{n} poruka",
  // Recovery
  // Payments
  // Misc
  yes: "Da",
  no: "Ne",

  // Analysis results
  analysis_result: "Rezultat analize:",
  analysis_what_looking: "Šta tražimo:",
  analysis_positive_kw: "Pozitivne ključne reči:",
  analysis_negative_kw: "Negativne ključne reči:",
  analysis_none: "nema",
  analysis_description: "Opis za proveru:",
  analysis_analyzing: "Analiziram upit...",
  analysis_generating_with_ratings: "Generišem ključne reči na osnovu tvojih ocena...",

  // Commands extended
  // List command
  list_no_subscriptions: "Nemaš još pretplata. Opiši šta tražiš.",
  list_sub_header: "Pretplata #{id}{pause}",
  list_sub_header_paused: "Pretplata #{id} ⏸️",
  list_query: "Upit:",
  list_keywords: "Ključne reči:",
  list_exclusions: "Izuzeci:",
  list_llm_description: "LLM Opis:",
  list_description: "Opis:",
  list_exclusions_disabled: "Izuzeci onemogućeni",
  list_exclusions_enabled: "Izuzeci omogućeni",
  list_exclusions_disabled_list: "(onemogućeni: {list})",

  // Settings
  settings_title: "Podešavanja",
  settings_current_mode: "Trenutni režim:",
  settings_mode_normal: "📊 Normalni",
  settings_mode_advanced: "🔬 Napredni",
  settings_normal_desc: "U normalnom režimu bot ne prikazuje ključne reči i ne postavlja pojašnjavajuća pitanja.",
  settings_advanced_desc: "U naprednom režimu vidiš ključne reči, možeš ih menjati i odgovaraš na pojašnjavajuća pitanja.",
  settings_mode_changed: "Režim promenjen",

  // Presets
  presets_not_configured: "Preseti regiona još nisu konfigurisani.",
  presets_intro: "Preset je skup svih buvljaka u regionu.\nKupi preset i dodaj sve grupe regiona u pretplatu jednim klikom.\n\nIzaberi region:",
  presets_select_region: "Izaberi region",
  presets_region_explanation: "Ovo je potrebno za prikaz preseta grupa pri kreiranju pretplate.",

  // Catalog
  catalog_open: "Otvori katalog proizvoda:",
  catalog_button: "Otvori katalog",

  // Groups
  groups_select_add: "Izaberi grupu ili kanal za dodavanje:",
  groups_none: "Nemaš dodanih grupa. Koristi /addgroup za dodavanje.",
  groups_list_header: "Tvoje grupe za praćenje:",
  groups_already_added: "Ova grupa je već dodata!",
  groups_private_need_link: "Privatna grupa \"{title}\".\n\nBot ne može da se pridruži bez invite linka.\nPošalji link tipa t.me/+XXX ili klikni Preskoči.",
  groups_select_more: "Izaberi još grupu ili klikni \"Gotovo\":",
  groups_not_added: "Grupe nisu dodate. Koristi /addgroup kada budeš spreman.",
  groups_added_processing: "Dodata {n} grupa. Obrađujem zahtev...|Dodate {n} grupe. Obrađujem zahtev...|Dodato {n} grupa. Obrađujem zahtev...",
  groups_added_ready: "Dodata {n} grupa. Sada opiši šta želiš da pratiš.|Dodate {n} grupe. Sada opiši šta želiš da pratiš.|Dodato {n} grupa. Sada opiši šta želiš da pratiš.",
  groups_joining: "Link primljen, pokušavam da se pridružim...",
  groups_invalid_format: "Neispravan format. Pošalji link tipa t.me/+XXX ili klikni Preskoči.",
  groups_skipped: "Grupa preskočena.",
  groups_select_for_monitoring: "Izaberi grupe za praćenje:",
  groups_selected_count: "Izabrano: {selected} od {total}",
  groups_adding: "Dodajem grupu...",

  // Metadata
  meta_marketplace_prompt: "Da li se proizvodi prodaju u grupi \"{title}\"?",
  meta_country_label: "Država grupe:",
  meta_country_prompt: "U kojoj državi je grupa? (npr. Srbija, Rusija)",
  meta_city_label: "Grad grupe:",
  meta_city_prompt: "Koji grad? (npr. Beograd, Moskva)",
  meta_currency_label: "Valuta grupe:",
  meta_currency_prompt: "Koja je glavna valuta? (npr. dinari, rublje, evro)",
  meta_country_error: "Ne mogu da prepoznam državu. Pokušaj drugačije (npr. Srbija, Serbia, RS)",
  meta_currency_error: "Ne mogu da prepoznam valutu. Pokušaj kod (EUR, RSD) ili ime (evro, dinar)",
  meta_confirmed: "Potvrđeno",
  meta_enter_value: "Unesi vrednost",
  // Subscription limits
  sub_limit_reached: "⚠️ Limit pretplata dostignut",
  sub_limit_your_plan: "Tvoj plan: {plan}",
  sub_limit_subs_count: "Pretplate: {current}/{max}",
  sub_limit_upgrade_prompt: "Da kreiraš više pretplata, pređi na sledeći plan.",
  sub_limit_upgrade_button: "Upgrade to {plan} — {price}⭐/mes",

  // Keywords editing
  kw_need_words: "Potrebna je bar jedna reč.",
  kw_description_short: "Opis je prekratak.",
  kw_positive: "Pozitivne:",
  kw_negative: "Negativne:",
  kw_added_full: "✅ Dodato: {added}",
  kw_send_numbers: "Pošalji brojeve reči odvojene zarezom (npr. 1, 3)",
  kw_invalid_numbers: "Neispravni brojevi.",
  kw_cant_delete_all: "Ne možeš obrisati sve pozitivne reči.",
  kw_word_not_found: "Reč nije pronađena",
  kw_cant_delete_last: "Ne možeš obrisati poslednju reč",
  kw_word_deleted: "Reč obrisana",
  kw_added: "✅ Dodato: {added}\nTrenutne: {current}",
  kw_description_updated: "✅ Opis ažuriran",
  kw_no_words_to_delete: "Nema reči za brisanje",
  kw_select_words: "Izaberi reči",
  // AI edit
  ai_correcting: "Korigovanja (može potrajati do minut)...",
  ai_changes: "Izmene:",
  ai_no_changes: "Bez izmena",
  ai_comment: "AI:",
  ai_example_messages: "Primeri poruka:",
  ai_error: "Greška obrade. Pokušaj preformulisati.",
  ai_new_description: "Novi opis:",
  ai_edit_mode: "AI režim uređivanja",
  ai_current_params: "Trenutni parametri:",
  ai_words: "- reči:",
  ai_edit_examples: `Primeri:
• "dodaj reč iznajmljivanje"
• "ukloni reč prodaja"
• "dodaj kancelarija u izuzetke"
• "promeni opis u ..."`,
  ai_describe_changes: "Opiši šta treba promeniti",
  ai_edit_short_examples: `Primeri:
• "dodaj reč iznajmljivanje"
• "ukloni reč prodaja"
• "dodaj kancelarija u izuzetke"`,
  ai_clarify_query: "Pojasni upit",
  ai_current_description: "Trenutni opis:",
  ai_clarify_examples: `Primeri:
• "tražim samo novo, ne polovne"
• "ne trebaju usluge, samo proizvodi"
• "dodaj da je potrebna dostava"`,
  ai_correction_mode_full: "AI režim korekcije",
  ai_applied: "Primenjeno!",
  ai_cancelled_full: "Uređivanje otkazano.",
  ai_generating: "Generišem...",
  ai_generation_error: "Greška generisanja. Pokušaj kasnije.",
  ai_changes_applied: "✅ Promene primenjene.",
  ai_regenerated_keywords: "Regenerisane ključne reči:",
  ai_plus_words: "+ reči:",
  ai_corrected_keywords: "Korigovane ključne reči:",
  ai_confirm_or_change: "Potvrdi ili promeni:",
  ai_continue_or_apply: "Možeš nastaviti uređivanje ili primeniti:",
  ai_keywords_auto_regen: "Ključne reči će biti automatski regenerisane.\nMožeš nastaviti preciziranje ili primeniti:",

  // Clarification questions
  clarify_question: "Pojašnjavajuće pitanje",
  clarify_generating: "Generišem pojašnjavajuća pitanja...",
  clarify_failed: "Nije uspelo generisanje pitanja, prelazim na primere...",
  clarify_default: "Koje konkretne karakteristike su važne?",
  clarify_analyzing: "Analiziram odgovore...",
  clarify_skipped: "Preskočeno",
  clarify_skipping: "Preskačem...",
  clarify_examples_skipped: "Primeri preskočeni.",

  // Forward analysis
  forward_no_text: "Poruka ne sadrži tekst.",
  forward_not_seen: "Bot nije video ovu poruku u praćenim grupama.",
  forward_not_analyzed: "Poruka još nije analizirana.",
  forward_not_analyzed_group: "Poruka iz \"{title}\" još nije analizirana.",
  forward_group_not_monitored: "Grupa ove poruke nije u tvom praćenju.",
  forward_group_unknown: "Nepoznato",
  forward_group_not_added: "Grupa \"{title}\" nije dodata u praćenje.",
  forward_cant_determine_source: "Ne mogu odrediti izvor poruke.",
  forward_unknown_group: "Nepoznata grupa",
  forward_unknown_sender: "Nepoznato",
  forward_sent_at: "Poslato {date}",
  forward_match_found: "Pronađeno poklapanje",

  // Rejection reasons
  reject_negative_kw: "Sadrži isključujuću reč \"{keyword}\"",
  reject_ngram: "Tekst je daleko od upita (sličnost {score}%)",
  reject_semantic_kw: "Blokirano semantičkim filterom: \"{keyword}\"",
  reject_semantic: "Semantika se nije poklopila ({score}%)",
  reject_llm_reason: "AI odbio: {reason}",
  reject_llm_confidence: "AI nije potvrdio poklapanje (pouzdanost {score}%)",
  reject_llm: "AI nije potvrdio poklapanje",
  reject_matched: "Poruka odgovara kriterijumima",
  reject_unknown: "Razlog nije određen",

  // Status texts
  status_matched: "Poklapanje",
  status_excluded: "Isključeno",
  status_ngram: "Nema poklapanja",
  status_semantic: "Semantika",
  status_llm: "AI odbio",
  status_unknown: "Nepoznato",

  // Date formatting
  date_unknown: "nepoznato",
  date_today: "danas u {time}",
  date_yesterday: "juče",
  date_days_ago: "{days} dana ranije",

  // Detailed analysis
  analysis_semantic: "Semantika: {score}%",
  analysis_scores: "Rezultati: {scores}",

  forward_analyzing: "Analiziram...",
  forward_no_subscriptions: "Nemaš aktivnih pretplata za analizu.",
  forward_no_matching_subs: "Nema pretplata za analizu ove poruke.",
  forward_results: "Rezultati analize:",
  forward_text_not_found: "Tekst poruke nije pronađen",
  forward_expanding: "Proširujem kriterijume...",
  forward_expanding_progress: "⏳ Izvlačim ključne reči i ažuriram pretplatu...",
  forward_expand_success: "✅ Kriterijumi prošireni!\n\nDodate reči: {words}",
  forward_expand_failed: "Nije uspelo izvlačenje ključnih reči iz poruke.",
  forward_expand_error: "Greška pri proširenju kriterijuma. Pokušaj kasnije.",
  forward_ai_correction: "AI korekcija",

  // Miss analysis
  miss_title: "Promašaj!",
  miss_analyzing: "Analiziram poruku...",
  miss_suggestion: "Predlog:",

  // Callbacks common
  cb_session_expired: "Sesija istekla",
  cb_subscription_created: "Pretplata kreirana",
  cb_select_groups: "Izaberi grupe",
  cb_select_action: "Izaberi akciju",
  cb_send_words: "Pošalji reči",
  cb_cancelled: "Otkazano",
  // Subscription callbacks
  sub_disabled: "Pretplata onemogućena",
  sub_no_groups_created: "Pretplata kreirana!\n\nNemaš dodanih grupa. Koristi /addgroup za dodavanje.",
  sub_need_groups_first: "Prvo treba da dodaš bar jednu grupu za praćenje.\n\nIzaberi grupu:",

  // Rating
  rating_example_title: "Primer {index}/{total}",
  rating_is_this_match: "Da li je ovo slično onome što tražiš?",
  rating_moving_next: "Prelazim na sledeće...",
  rating_all_done: "Svi primeri ocenjeni!",
  rating_intro: `📝 Pokazaću ti primere — oceni ih da bih bolje razumeo šta tražiš.

Bot koristi AI, ključne reči i semantičku analizu — pronalazi objave sa greškama u kucanju, na različitim jezicima, drugačije formulisane, pa čak i analizira slike kada tekst nije jasan.`,

  // Feedback
  feedback_outcome_bought: "Kupio",
  feedback_outcome_not_bought: "Nisam kupio",
  feedback_outcome_complicated: "Komplikovano je",
  feedback_review_prompt: "Hvala na odgovoru!\n\nOstavi recenziju porukom (šta ti se svidelo, šta može biti bolje):",
  feedback_thanks: "Hvala!",
  feedback_thanks_full: "Hvala na povratnoj informaciji!",

  // Payment errors
  pay_invalid_plan: "Neispravan plan",
  pay_creating_link: "Kreiram link za plaćanje...",
  pay_link_error: "Greška pri kreiranju linka za plaćanje. Pokušaj kasnije.",
  pay_creating_invoice: "Kreiram račun...",
  pay_invoice_error: "Greška pri kreiranju računa. Pokušaj kasnije.",
  pay_user_not_found: "Korisnik nije pronađen",
  pay_verification_error: "Greška verifikacije plaćanja",
  pay_preset_not_found: "Preset nije pronađen",
  pay_processing_error: "Greška obrade plaćanja",
  pay_unknown_type: "Nepoznata vrsta plaćanja",
  pay_preset_missing: "Preset nije naveden",
  pay_group_missing: "Grupa nije navedena",
  pay_product_missing: "Proizvod nije naveden",
  pay_publication_missing: "Publikacija nije navedena",

  // Payment success messages
  pay_sub_activated: "✅ {plan} pretplata aktivirana do {date}",
  pay_analyze_started: "✅ Plaćanje prihvaćeno, pokrećem analizu...",
  pay_preset_access_lifetime: "✅ Pristup presetu \"{name}\" aktiviran zauvek",
  pay_preset_access_month: "✅ Pristup presetu \"{name}\" aktiviran na 30 dana",
  pay_group_promo_activated: "✅ Promocija grupe aktivirana na {days} dana",
  pay_product_promo_activated: "✅ Promocija proizvoda aktivirana na {days} dana",
  pay_publication_started: "✅ Plaćanje prihvaćeno! Počinjemo sa publikacijom...",

  // Plan descriptions
  plan_basic_desc: "10 pretplata, 20 grupa, prioritetna obaveštenja",
  plan_pro_desc: "50 pretplata, neograničeno grupa, fora, 50% popust na analizu",
  plan_business_desc: "Neograničeno svega, besplatna analiza",
  plan_subscription_title: "{plan} pretplata",
  plan_label: "{plan} plan",

  // Plan info
  plan_info_title: "💎 Tvoj plan: {plan}\n\n",
  plan_info_limits: "Limiti:\n",
  plan_info_subs: "• Pretplata: {current}/{max}\n",
  plan_info_groups: "• Grupa po pretplati: {max}\n",
  plan_info_free_analyzes: "• Besplatnih analiza: {used}/1 (u 6 meseci)\n",
  plan_info_priority: "• ⚡ Prioritetna obaveštenja\n",
  plan_info_fora: "• 👥 Vidi koliko ljudi traži isto\n",
  plan_info_free_analysis: "• 🔍 Besplatna analiza proizvoda\n",
  plan_info_discount_analysis: "• 🔍 Analiza sa 50% popusta ({price}⭐)\n",
  plan_info_expires: "\n📅 Važi do: {date}",

  // Presets callbacks
  preset_not_found: "Preset nije pronađen",
  preset_selected: "Preset izabran",
  preset_deselected: "Preset poništen",
  preset_no_groups: "Nema grupa iz ovog preseta",
  preset_all_selected: "Sve izabrano",
  preset_all_deselected: "Sve poništeno",

  // Promotion
  promo_only_own_posts: "Možeš promovisati samo svoje objave",
  promo_only_admin_groups: "Možeš promovisati samo grupe gde si admin",
  promo_already_promoted: "Grupa se već promoviše",
  promo_cancelled: "Promocija otkazana.",
  promo_not_found: "Promocija nije pronađena",
  promo_opening_payment: "Otvaraю plaćanje...",
  promo_product_desc: "Proizvod će biti viši u WebApp pretrazi",
  promo_group_desc: "Grupa će biti preporučena korisnicima",

  // Analysis payment
  analysis_title: "Analiza oglasa",
  analysis_desc: "Potpuna analiza: tržišne cene, provera prevare, slični proizvodi",
  analysis_error: "Greška analize. Pokušaj kasnije.",
  analysis_data_not_found: "Podaci nisu pronađeni",
  analysis_message_not_found: "Poruka nije pronađena u bazi",
  analysis_no_original: "Originalna poruka nije pronađena",

  // Generic
  error: "Greška",
  error_data: "Greška podataka",
  selected: "Izabrano",
  deselected: "Poništeno",
  already_selected: "Već izabrano",

  // Additional callbacks
  sub_paused_list: "Pretplata pauzirana. /list za nastavak.",
  sub_disabled_ask_feedback: "Pretplata onemogućena.\n\nDa li si uspeo da kupiš?",
  sub_created_no_groups: "Pretplata kreirana! Grupe nisu izabrane, praćenje svih dostupnih.",
  cancel_send_new_query: "Otkazano. Pošalji novi upit kada budeš spreman.",
  unknown_query: "Nepoznat upit",
  example_deleted: " (obrisano)",
  example_generated: "🤖 Generisan primer",
  kw_added_current: "✅ Dodato: {added}\nTrenutno: {current}",
  kw_removed_remaining: "✅ Uklonjeno: {removed}\nPreostalo: {remaining}",
  kw_removed_all: "✅ Uklonjeno: {removed}",
  kw_positive_label: "Pozitivne",
  kw_negative_label: "Negativne",
  kw_words_list: "{label} reči:\n{list}\n\nKlikni reč ili pošalji brojeve razdvojene zarezom:",
  kw_current_send_add: "Trenutno: {current}\n\nPošalji reči za dodavanje razdvojene zarezom:",
  kw_current_description: "Trenutni opis:\n{desc}\n\nPošalji novi opis za LLM verifikaciju:",
  ai_send_description: "Pošalji novi opis",
  ai_edit_mode_short: "Režim uređivanja",
  ai_describe_changes_short: "Opiši izmene",
  ai_correction_mode_short: "Režim korekcije",

  // Diff text
  diff_added: "+ Dodato: {list}",
  diff_removed: "- Uklonjeno: {list}",
  diff_added_exclusions: "+ Isključenja: {list}",
  diff_removed_exclusions: "- Iz isključenja: {list}",
  diff_description: "Opis: {desc}",

  // Subscription created messages
  sub_created_scanning: "Pretplata kreirana! Praćenje grupa: {groups}\n\n⏳ Skeniram istoriju poruka...",
  sub_created_found: "✅ Pretplata kreirana! Praćenje grupa: {groups}\n\n📬 Pronađeno {count} u istoriji.",
  sub_created_sent_partial: "\n\n📤 Poslato prvih 5 od {total}. Ostale će se pojaviti u feedu sa novim podudaranjima.",
  sub_created_not_found: "✅ Pretplata kreirana! Praćenje grupa: {groups}\n\n📭 Nije pronađeno podudaranja u istoriji.",
  sub_created_scan_error: "✅ Pretplata kreirana! Praćenje grupa: {groups}\n\n⚠️ Greška skeniranja istorije.",

  // Notification keyboard
  notif_go_to_post: "📎 Idi na objavu",
  notif_analyze: "🔍 Analiza",
  notif_analyze_free: "🔍 Analiza (1 besplatna)",
  notif_analyze_price: "🔍 Analiza — {price}⭐",
  notif_miss: "👎 Promašaj",
  notif_pause_sub: "⏸️ Zaustavi pretplatu",
  notif_promote: "🚀 Promoviši",
  notif_already_promoted: "✅ Već se promoviše",

  // Rating marked
  rating_marked_relevant: "🔥 Označio si kao relevantno",
  rating_recorded: "Zapisano",

  // Admin feedback
  admin_feedback_bought: "✅ Kupio",
  admin_feedback_not_bought: "❌ Nije kupio",
  admin_feedback_complicated: "🤷 Komplikovano je",
  admin_feedback_from: "📝 Povratna informacija od {user}:\n{outcome}\n\nUpit: {query}\n\nRecenzija: {review}",

  // Group add
  group_adding_count: "Dodajem {count}...",
  group_added_success: "{icon} \"{title}\" dodata!",
  group_add_failed: "Nije uspelo dodavanje \"{title}\": {error}",

  // Keyword editing for pending subscription
  kw_pending_positive: "Pozitivne reči: {list}\n\nŠta uraditi?",
  kw_pending_negative: "Negativne reči: {list}\n\nŠta uraditi?",
  kw_answer_removed: "Uklonjeno: {removed}",
  kw_select_words_numbered: "{label} reči:\n{list}\n\nKlikni reč ili pošalji brojeve razdvojene zarezom:",
  kw_deleted: "✅ Uklonjeno: {list}",

  // Miss analysis
  miss_no_changes: "Bez promena",
  miss_clarify_or_apply: "Možeš pojasniti ili primeniti:",
  miss_error_describe: "Greška analize. Opiši svojim rečima šta promeniti u pretplati \"{query}\":",
  miss_text_unavailable: "[tekst nedostupan]",
  miss_context: "Ova poruka je prikazana ali je promašaj:\n\"{text}\"\n\nPredloži kako promeniti pretplatu da se takve poruke ne prikazuju.",

  // Group quick add
  group_unknown: "Nepoznata grupa",
  group_adding_progress: "⏳ Dodajem grupu \"{title}\"...",
  group_cant_read: "Bot ne može čitati ovu grupu. Koristi /addgroup i pošalji link za pozivnicu.",
  group_added_to_monitoring: "✅ Grupa \"{title}\" dodata u praćenje.",
  group_add_use_addgroup: "Nije uspelo dodavanje grupe. Koristi /addgroup.",

  // Metadata prompts (short)
  meta_prompt_country: "Unesi državu (npr: Srbija, Rusija, Crna Gora):",
  meta_prompt_city: "Unesi grad (npr: Beograd, Moskva):",
  meta_prompt_currency: "Unesi valutu (npr: dinar, evro, rublja):",
  meta_answer_yes: "Da",
  meta_answer_no: "Ne",

  // Presets detailed
  preset_title: "🗺️ **Preseti regiona**\n\nPreset je kolekcija svih marketplace grupa u regionu.\nKupi preset i dodaj sve grupe regiona u pretplatu jednim klikom.\n\nIzaberi region:",
  preset_country: "📍 Država: {value}",
  preset_currency: "💱 Valuta: {value}",
  preset_groups_count: "👥 Grupa u presetu: {count}",
  preset_has_access: "✅ Imaš pristup ovom presetu",
  preset_need_buy: "🔒 Potrebna kupovina za pristup",
  preset_buy_title: "Preset: {name}",
  preset_buy_desc_lifetime: "Doživotni pristup za {count} grupa",
  preset_buy_desc_month: "30-dnevni pristup za {count} grupa",
  preset_region_saved: "Region sačuvan: {name}",
  preset_region: "Region: {name}",

  // Promotion detailed
  promo_already_until: "Već se promoviše do {date}",
  promo_status: "Promocija do {date} ({days} dana)",
  promo_product_title: "Promocija proizvoda ({days} dana)",
  promo_group_title_days: "Promocija grupe ({days} dana)",
  promo_product_full: "🚀 **Promocija proizvoda**\n\nIzaberi trajanje promocije:\n• Proizvod će biti viši u WebApp pretrazi\n• Prikazuje se dok se čeka analiza",
  promo_group_full: "🚀 **Promocija grupe**\n\nIzaberi trajanje promocije:\n• Grupa će biti preporučena korisnicima",

  // Premium
  premium_select_plan: "💎 {plan} pretplata\n\nKlikni dugme ispod za plaćanje:",
  premium_pay_button: "Plati {plan}",
  premium_back: "← Nazad",

  // Analysis (product)
  analysis_product_analyzing: "⏳ Analiziram oglas...\nOvo može potrajati 10-30 sekundi.",

  // Waiting message
  waiting_promo: "📢 Dok čekamo:\n\n",

  // AI edit for existing subscription
  ai_edit_existing_prompt: "Opiši kako promeniti kriterijume pretrage za pretplatu \"{query}\".\n\nPrimer: «dodaj reči o popustima» ili «ukloni previše stroge filtere»",
  ai_keyword_removed: "✅ Reč \"{keyword}\" uklonjena iz isključenja.\n\nPretplata: \"{query}\"\nIsključujuće reči: {remaining}",

  // Notification format
  notif_group: "Grupa: {title}",
  notif_group_link: "Grupa: [{title}](https://t.me/{username})",
  notif_competitors: "\n👥 ~{count} ljudi takođe traži ovo",
  notif_reason: "💡 Razlog: {reason}",

  // Publish flow
  pub_disabled: "⚠️ Objavljivanje privremeno nedostupno. Obrati se administratoru.",
  pub_title: "📢 **Objavljivanje oglasa**",
  pub_intro: "Objavi oglase na sve buvljake regiona jednim klikom!",
  pub_connected: "✅ Tvoj Telegram nalog je povezan",
  pub_need_connect: "Za objavljivanje treba povezati tvoj Telegram nalog. Oglasi će se slati sa tvog naloga.",
  pub_price: "Cena: {price}⭐ po objavi na sve grupe preseta",
  pub_connect_title: "🔗 *Povezivanje Telegrama*",
  pub_connect_intro: "Za objavljivanje oglasa treba autorizovati tvoj Telegram nalog.",
  pub_send_phone: "📱 Pošalji svoj broj telefona u formatu:\n+381601234567",
  pub_invalid_phone: "❌ Neispravan format. Pošalji broj sa kodom države, npr.: +381601234567",
  pub_error: "❌ Greška: {error}",
  pub_error_retry: "❌ Greška: {error}\n\nPokušaj ponovo sa /publish",
  pub_code_sent: "📨 Kod poslat u Telegram!\n\nUnesi kod:",
  pub_enter_2fa: "🔐 Unesi lozinku dvofaktorske autentifikacije:",
  pub_connected_success: "✅ **Nalog povezan!**\n\nSada možeš objavljivati oglase na buvljacima.",
  pub_text_saved: "✅ Tekst sačuvan",
  pub_text_saved_photos: "✅ Tekst sačuvan (+ {count} slika)",
  pub_add_more: "Možeš dodati još teksta ili slika, ili klikni «Gotovo» za prelazak na potvrdu.",
  pub_max_photos: "❌ Maksimalno 10 slika. Obriši višak ili klikni «Gotovo».",
  pub_photo_added: "📷 Slika dodata ({current}/10)",
  pub_photo_added_text: "📷 Slika dodata ({current}/10) + tekst sačuvan",
  pub_add_text_reminder: "\n\nNe zaboravi da dodaš tekst oglasa!",
  pub_no_active: "❌ Nema aktivnog oglasa. Počni sa /publish",
  pub_need_text: "❌ Dodaj tekst oglasa!",
  pub_create_error: "❌ Greška kreiranja publikacije. Pokušaj kasnije.",
  pub_review_title: "📋 *Proveri oglas pre objavljivanja*",
  pub_review_photos: "📷 *Slike:* {count} kom.",
  pub_review_dest: "*Gde:* {preset} ({groups} grupa)",
  pub_review_price: "*Cena:* {price}⭐",
  pub_how_it_works_title: "🤖 *Kako funkcioniše objavljivanje:*",
  pub_how_it_works: "Nakon plaćanja, bot će za svaku grupu:\n1. Generisati jedinstvenu verziju teksta preko AI (da ne izgleda kao spam)\n2. Pokazati ti za proveru\n3. Poslati tek nakon tvoje potvrde\n\nMožeš izmeniti ili preskočiti bilo koju grupu.",
  pub_free_credits: "🎁 Imaš *{count}* besplatnih publikacija!",
  pub_daily_limit: "❌ Dnevni limit publikacija dostignut (10). Pokušaj sutra.",
  pub_no_presets: "❌ Nema dostupnih preseta sa grupama.",
  pub_select_region: "📝 *Kreiranje oglasa*\n\nIzaberi region za objavljivanje:",
  pub_create_title: "📝 *Kreiranje oglasa*",
  pub_create_region: "*Region:* {region}",
  pub_create_instructions: "Pošalji:\n• Tekst oglasa (opis, cena, kontakti)\n• Slike (do 10 komada)\n\nMožeš poslati prvo tekst, pa slike — ili obrnuto.\n\nKada završiš — klikni ✅ *Gotovo*",
  pub_invoice_title: "Objavljivanje oglasa",
  pub_invoice_desc: "Objava na sve grupe preseta",
  pub_not_found: "❌ Publikacija nije pronađena.",
  pub_no_credits: "❌ Nemaš besplatnih publikacija.",
  pub_credit_used: "🎁 Besplatna publikacija aktivirana!",
  pub_no_publications: "📋 Nemaš još publikacija.",
  pub_status_pending: "⏳ Čeka",
  pub_status_processing: "🔄 Objavljuje se",
  pub_status_completed: "✅ Gotovo",
  pub_status_failed: "❌ Greška",
  pub_status_cancelled: "🚫 Otkazano",
  pub_my_title: "📋 *Moje publikacije*",
  pub_disconnected: "✅ Nalog odspojen. Za objavljivanje, poveži ga ponovo.",
  pub_cancelled: "Otkazano.",
  pub_publication_cancelled: "Publikacija otkazana.",
  pub_unknown_region: "Nepoznat region",
  pub_region: "Region",

  // Recovery
  recovery_resuming: "⏳ Bot je restartovan, nastavljam operaciju...",
  recovery_keywords_restored: "⏳ Bot je restartovan. Ključne reči vraćene:",
  recovery_positive: "🔍 Pozitivne: {keywords}",
  recovery_negative: "🚫 Negativne: {keywords}",
  recovery_confirm: "Potvrdi ili koriguj:",
  recovery_ai_correct_failed: "❌ Nije uspelo vraćanje AI korekcije. Pokušaj ponovo.",
  recovery_ai_correct_restored: "✅ AI korekcija vraćena:",
  recovery_ai_correct_apply: "Pošalji \"primeni\" da koristiš ove ključne reči, ili opiši druge izmene.",
  recovery_ai_edit_failed: "❌ Nije uspelo vraćanje AI uređivanja. Pokušaj ponovo.",
  recovery_ai_edit_restored: "✅ AI uređivanje vraćeno:",
  recovery_ai_edit_apply: "Pošalji \"primeni\" da sačuvaš izmene.",
  recovery_query_lost: "⚠️ Bot je restartovan tokom analize upita.\nPošalji svoj upit ponovo da počneš ispočetka.",
  recovery_clarify_continue: "⏳ Bot je restartovan. Nastavljamo:",
  recovery_clarify_question: "**Pojašnjavajuće pitanje** ({current}/{total})",
  recovery_examples_restart: "⏳ Bot je restartovan. Nastavljamo sa primerima.\nKoristi /start da počneš ispočetka.",
  recovery_session_failed: "❌ Nije uspelo vraćanje sesije nakon restarta.\nPošalji svoj upit ponovo.",
  recovery_examples_lost: "⚠️ Bot je restartovan tokom generisanja primera.\nPošalji svoj upit ponovo.",
  recovery_examples_skipped: "⏳ Bot je restartovan. Preskačemo primere, ključne reči su spremne:",

  // Deep analysis plurals (format: one|few|many)

  // Referrals
  referral_new_user: "🎉 Novi korisnik se pridružio preko tvog linka: {name}",
  referral_title: "🔗 *Referalni program*",
  referral_link: "Tvoj link: `{link}`",
  referral_balance: "💰 Bonus stanje: {amount}⭐",
  referral_stats: "👥 Pozvano: {count} | Zarađeno: {total}⭐",
  referral_info: "Pozovi prijatelje i zaradi 10% od njihovih kupovina!",
  referral_earned: "🎁 Zaradio si {amount}⭐ bonus od kupovine korisnika {name}!",
  bonus_applied: "✅ Iskorišćeno {amount}⭐ bonusa",
  bonus_offer: "💰 Imaš {balance}⭐ bonusa. Iskoristiti?",
  bonus_use_full: "Iskoristi {amount}⭐ (besplatno)",
  bonus_use_partial: "Iskoristi {bonus}⭐ (plati {remaining}⭐)",
  bonus_skip: "Ne koristi bonus",

  // Tips (shown during LLM processing)
  tip_referral: "💡 Pozovi prijatelje i zaradi 10% od njihovih kupovina! /referral",
  tip_plans: "💡 Na Pro planu analiza košta samo 10⭐ umesto 20⭐",
  tip_usecase_rare: "💡 Bot je odličan za pronalaženje retkih stvari — prati grupe 24/7",
  tip_usecase_price: "💡 Prati cene: napravi pretplatu za 'iPhone ispod 300€'",
};

export default rs;
