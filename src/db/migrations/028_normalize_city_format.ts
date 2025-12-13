/**
 * Migration: Normalize city format in groups table.
 * Converts old formats (Belgrade, Белград, beograd) to new format (rs_belgrade).
 */
import { Database } from "bun:sqlite";

// Case-insensitive mapping: old format → new format
const CITY_MAPPING: Record<string, string> = {
  // Serbia
  belgrade: "rs_belgrade",
  beograd: "rs_belgrade",
  београд: "rs_belgrade",
  белград: "rs_belgrade",
  "novi sad": "rs_novi_sad",
  "novi-sad": "rs_novi_sad",
  "нови сад": "rs_novi_sad",
  "нови-сад": "rs_novi_sad",
  nis: "rs_nis",
  niš: "rs_nis",
  ниш: "rs_nis",

  // Montenegro
  podgorica: "me_podgorica",
  подгорица: "me_podgorica",
  budva: "me_budva",
  будва: "me_budva",
  bar: "me_bar",
  бар: "me_bar",
  tivat: "me_tivat",
  тиват: "me_tivat",

  // Russia
  moscow: "ru_moscow",
  москва: "ru_moscow",
  мск: "ru_moscow",
  "saint petersburg": "ru_spb",
  "st. petersburg": "ru_spb",
  "st petersburg": "ru_spb",
  petersburg: "ru_spb",
  "санкт-петербург": "ru_spb",
  питер: "ru_spb",
  спб: "ru_spb",
  novosibirsk: "ru_novosibirsk",
  новосибирск: "ru_novosibirsk",
  ekaterinburg: "ru_ekaterinburg",
  екатеринбург: "ru_ekaterinburg",
  kazan: "ru_kazan",
  казань: "ru_kazan",
  sochi: "ru_sochi",
  сочи: "ru_sochi",
  krasnodar: "ru_krasnodar",
  краснодар: "ru_krasnodar",
  "rostov-on-don": "ru_rostov",
  rostov: "ru_rostov",
  "ростов-на-дону": "ru_rostov",
  ростов: "ru_rostov",

  // Georgia
  tbilisi: "ge_tbilisi",
  тбилиси: "ge_tbilisi",
  batumi: "ge_batumi",
  батуми: "ge_batumi",

  // Armenia
  yerevan: "am_yerevan",
  ереван: "am_yerevan",

  // Turkey
  istanbul: "tr_istanbul",
  стамбул: "tr_istanbul",
  antalya: "tr_antalya",
  анталья: "tr_antalya",
  ankara: "tr_ankara",
  анкара: "tr_ankara",
  izmir: "tr_izmir",
  измир: "tr_izmir",

  // UAE
  dubai: "ae_dubai",
  дубай: "ae_dubai",
  "abu dhabi": "ae_abu_dhabi",
  "abu-dhabi": "ae_abu_dhabi",
  "абу-даби": "ae_abu_dhabi",

  // Thailand
  bangkok: "th_bangkok",
  бангкок: "th_bangkok",
  phuket: "th_phuket",
  пхукет: "th_phuket",
  pattaya: "th_pattaya",
  паттайя: "th_pattaya",
  "chiang mai": "th_chiang_mai",
  чиангмай: "th_chiang_mai",

  // Indonesia
  bali: "id_bali",
  бали: "id_bali",
  jakarta: "id_jakarta",
  джакарта: "id_jakarta",

  // Kazakhstan
  almaty: "kz_almaty",
  алматы: "kz_almaty",
  "алма-ата": "kz_almaty",
  astana: "kz_astana",
  астана: "kz_astana",
  "нур-султан": "kz_astana",

  // Ukraine
  kyiv: "ua_kyiv",
  kiev: "ua_kyiv",
  киев: "ua_kyiv",
  київ: "ua_kyiv",
  odessa: "ua_odessa",
  одесса: "ua_odessa",
  одеса: "ua_odessa",
  kharkiv: "ua_kharkiv",
  харьков: "ua_kharkiv",
  харків: "ua_kharkiv",
  lviv: "ua_lviv",
  львов: "ua_lviv",
  львів: "ua_lviv",

  // Belarus
  minsk: "by_minsk",
  минск: "by_minsk",
  мінск: "by_minsk",

  // Germany
  berlin: "de_berlin",
  берлин: "de_berlin",
  munich: "de_munich",
  münchen: "de_munich",
  мюнхен: "de_munich",
  frankfurt: "de_frankfurt",
  франкфурт: "de_frankfurt",
  hamburg: "de_hamburg",
  гамбург: "de_hamburg",

  // Other European
  paris: "fr_paris",
  париж: "fr_paris",
  london: "gb_london",
  лондон: "gb_london",
  amsterdam: "nl_amsterdam",
  амстердам: "nl_amsterdam",
  barcelona: "es_barcelona",
  барселона: "es_barcelona",
  madrid: "es_madrid",
  мадрид: "es_madrid",
  rome: "it_rome",
  roma: "it_rome",
  рим: "it_rome",
  milan: "it_milan",
  milano: "it_milan",
  милан: "it_milan",
  prague: "cz_prague",
  praha: "cz_prague",
  прага: "cz_prague",
  warsaw: "pl_warsaw",
  warszawa: "pl_warsaw",
  варшава: "pl_warsaw",
  vienna: "at_vienna",
  wien: "at_vienna",
  вена: "at_vienna",
  lisbon: "pt_lisbon",
  lisboa: "pt_lisbon",
  лиссабон: "pt_lisbon",

  // Cyprus
  limassol: "cy_limassol",
  лимассол: "cy_limassol",
  larnaca: "cy_larnaca",
  ларнака: "cy_larnaca",
  nicosia: "cy_nicosia",
  никосия: "cy_nicosia",
  paphos: "cy_paphos",
  пафос: "cy_paphos",

  // Americas
  "new york": "us_new_york",
  nyc: "us_new_york",
  "нью-йорк": "us_new_york",
  "los angeles": "us_los_angeles",
  la: "us_los_angeles",
  "лос-анджелес": "us_los_angeles",
  miami: "us_miami",
  майами: "us_miami",
};

export function migrate(db: Database) {
  const groups = db
    .query<{ telegram_id: number; city: string }, []>(
      "SELECT telegram_id, city FROM groups WHERE city IS NOT NULL AND city != ''"
    )
    .all();

  if (groups.length === 0) {
    return;
  }

  const update = db.prepare("UPDATE groups SET city = ? WHERE telegram_id = ?");
  let updated = 0;

  for (const { telegram_id, city } of groups) {
    // Skip if already in new format (contains underscore)
    if (city.includes("_")) {
      continue;
    }

    const normalized = city.toLowerCase().trim();
    const newCity = CITY_MAPPING[normalized];

    if (newCity) {
      update.run(newCity, telegram_id);
      updated++;
    }
  }

  if (updated > 0) {
    console.log(`[028] Normalized ${updated} city codes to new format`);
  }
}
