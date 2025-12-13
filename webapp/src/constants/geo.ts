/**
 * Geo constants for admin datalists.
 * Format: country=ISO 3166-1 alpha-2, city={country}_{city_snake_case}, currency=ISO 4217
 */

// Countries — ISO 3166-1 alpha-2
export const COUNTRIES = [
  // Balkans (primary)
  { code: "RS", label: "Serbia" },
  { code: "ME", label: "Montenegro" },
  { code: "BA", label: "Bosnia" },
  { code: "HR", label: "Croatia" },
  { code: "MK", label: "North Macedonia" },
  { code: "AL", label: "Albania" },
  { code: "BG", label: "Bulgaria" },
  { code: "RO", label: "Romania" },
  { code: "SI", label: "Slovenia" },

  // CIS / Post-Soviet
  { code: "RU", label: "Russia" },
  { code: "UA", label: "Ukraine" },
  { code: "BY", label: "Belarus" },
  { code: "KZ", label: "Kazakhstan" },
  { code: "AM", label: "Armenia" },
  { code: "GE", label: "Georgia" },
  { code: "AZ", label: "Azerbaijan" },
  { code: "UZ", label: "Uzbekistan" },
  { code: "MD", label: "Moldova" },

  // Middle East / Asia
  { code: "TR", label: "Turkey" },
  { code: "AE", label: "UAE" },
  { code: "IL", label: "Israel" },
  { code: "CY", label: "Cyprus" },
  { code: "TH", label: "Thailand" },
  { code: "ID", label: "Indonesia" },
  { code: "VN", label: "Vietnam" },
  { code: "MY", label: "Malaysia" },
  { code: "SG", label: "Singapore" },

  // Western Europe
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "IT", label: "Italy" },
  { code: "ES", label: "Spain" },
  { code: "PT", label: "Portugal" },
  { code: "NL", label: "Netherlands" },
  { code: "BE", label: "Belgium" },
  { code: "AT", label: "Austria" },
  { code: "CH", label: "Switzerland" },
  { code: "GB", label: "UK" },
  { code: "IE", label: "Ireland" },

  // Nordic
  { code: "SE", label: "Sweden" },
  { code: "NO", label: "Norway" },
  { code: "FI", label: "Finland" },
  { code: "DK", label: "Denmark" },

  // Eastern Europe
  { code: "PL", label: "Poland" },
  { code: "CZ", label: "Czechia" },
  { code: "SK", label: "Slovakia" },
  { code: "HU", label: "Hungary" },

  // Americas
  { code: "US", label: "USA" },
  { code: "CA", label: "Canada" },
  { code: "MX", label: "Mexico" },
  { code: "BR", label: "Brazil" },
  { code: "AR", label: "Argentina" },

  // Other
  { code: "AU", label: "Australia" },
  { code: "NZ", label: "New Zealand" },
  { code: "EG", label: "Egypt" },
] as const;

// Cities — format {country_lowercase}_{city_snake_case}
export const CITIES = [
  // Serbia
  { code: "rs_belgrade", label: "Belgrade", country: "RS" },
  { code: "rs_novi_sad", label: "Novi Sad", country: "RS" },
  { code: "rs_nis", label: "Niš", country: "RS" },

  // Montenegro
  { code: "me_podgorica", label: "Podgorica", country: "ME" },
  { code: "me_budva", label: "Budva", country: "ME" },
  { code: "me_bar", label: "Bar", country: "ME" },
  { code: "me_tivat", label: "Tivat", country: "ME" },

  // Russia
  { code: "ru_moscow", label: "Moscow", country: "RU" },
  { code: "ru_spb", label: "Saint Petersburg", country: "RU" },
  { code: "ru_novosibirsk", label: "Novosibirsk", country: "RU" },
  { code: "ru_ekaterinburg", label: "Ekaterinburg", country: "RU" },
  { code: "ru_kazan", label: "Kazan", country: "RU" },
  { code: "ru_sochi", label: "Sochi", country: "RU" },
  { code: "ru_krasnodar", label: "Krasnodar", country: "RU" },
  { code: "ru_rostov", label: "Rostov-on-Don", country: "RU" },

  // Georgia
  { code: "ge_tbilisi", label: "Tbilisi", country: "GE" },
  { code: "ge_batumi", label: "Batumi", country: "GE" },

  // Armenia
  { code: "am_yerevan", label: "Yerevan", country: "AM" },

  // Turkey
  { code: "tr_istanbul", label: "Istanbul", country: "TR" },
  { code: "tr_antalya", label: "Antalya", country: "TR" },
  { code: "tr_ankara", label: "Ankara", country: "TR" },
  { code: "tr_izmir", label: "Izmir", country: "TR" },

  // UAE
  { code: "ae_dubai", label: "Dubai", country: "AE" },
  { code: "ae_abu_dhabi", label: "Abu Dhabi", country: "AE" },

  // Thailand
  { code: "th_bangkok", label: "Bangkok", country: "TH" },
  { code: "th_phuket", label: "Phuket", country: "TH" },
  { code: "th_pattaya", label: "Pattaya", country: "TH" },
  { code: "th_chiang_mai", label: "Chiang Mai", country: "TH" },

  // Indonesia
  { code: "id_bali", label: "Bali", country: "ID" },
  { code: "id_jakarta", label: "Jakarta", country: "ID" },

  // Kazakhstan
  { code: "kz_almaty", label: "Almaty", country: "KZ" },
  { code: "kz_astana", label: "Astana", country: "KZ" },

  // Ukraine
  { code: "ua_kyiv", label: "Kyiv", country: "UA" },
  { code: "ua_odessa", label: "Odessa", country: "UA" },
  { code: "ua_kharkiv", label: "Kharkiv", country: "UA" },
  { code: "ua_lviv", label: "Lviv", country: "UA" },

  // Belarus
  { code: "by_minsk", label: "Minsk", country: "BY" },

  // Germany
  { code: "de_berlin", label: "Berlin", country: "DE" },
  { code: "de_munich", label: "Munich", country: "DE" },
  { code: "de_frankfurt", label: "Frankfurt", country: "DE" },
  { code: "de_hamburg", label: "Hamburg", country: "DE" },

  // Other European cities
  { code: "fr_paris", label: "Paris", country: "FR" },
  { code: "gb_london", label: "London", country: "GB" },
  { code: "nl_amsterdam", label: "Amsterdam", country: "NL" },
  { code: "es_barcelona", label: "Barcelona", country: "ES" },
  { code: "es_madrid", label: "Madrid", country: "ES" },
  { code: "it_rome", label: "Rome", country: "IT" },
  { code: "it_milan", label: "Milan", country: "IT" },
  { code: "cz_prague", label: "Prague", country: "CZ" },
  { code: "pl_warsaw", label: "Warsaw", country: "PL" },
  { code: "at_vienna", label: "Vienna", country: "AT" },
  { code: "pt_lisbon", label: "Lisbon", country: "PT" },

  // Cyprus
  { code: "cy_limassol", label: "Limassol", country: "CY" },
  { code: "cy_larnaca", label: "Larnaca", country: "CY" },
  { code: "cy_nicosia", label: "Nicosia", country: "CY" },
  { code: "cy_paphos", label: "Paphos", country: "CY" },

  // Americas
  { code: "us_new_york", label: "New York", country: "US" },
  { code: "us_los_angeles", label: "Los Angeles", country: "US" },
  { code: "us_miami", label: "Miami", country: "US" },
] as const;

// Currencies — ISO 4217
export const CURRENCIES = [
  // Major
  { code: "USD", label: "US Dollar" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "British Pound" },

  // Balkans
  { code: "RSD", label: "Serbian Dinar" },
  { code: "BAM", label: "Bosnian Mark" },
  { code: "MKD", label: "Macedonian Denar" },
  { code: "ALL", label: "Albanian Lek" },
  { code: "BGN", label: "Bulgarian Lev" },
  { code: "RON", label: "Romanian Leu" },

  // CIS
  { code: "RUB", label: "Russian Ruble" },
  { code: "UAH", label: "Ukrainian Hryvnia" },
  { code: "BYN", label: "Belarusian Ruble" },
  { code: "KZT", label: "Kazakh Tenge" },
  { code: "AMD", label: "Armenian Dram" },
  { code: "GEL", label: "Georgian Lari" },
  { code: "AZN", label: "Azerbaijani Manat" },
  { code: "UZS", label: "Uzbek Som" },
  { code: "MDL", label: "Moldovan Leu" },

  // Other European
  { code: "CHF", label: "Swiss Franc" },
  { code: "PLN", label: "Polish Zloty" },
  { code: "CZK", label: "Czech Koruna" },
  { code: "HUF", label: "Hungarian Forint" },
  { code: "SEK", label: "Swedish Krona" },
  { code: "NOK", label: "Norwegian Krone" },
  { code: "DKK", label: "Danish Krone" },

  // Middle East / Asia
  { code: "TRY", label: "Turkish Lira" },
  { code: "AED", label: "UAE Dirham" },
  { code: "ILS", label: "Israeli Shekel" },
  { code: "THB", label: "Thai Baht" },
  { code: "IDR", label: "Indonesian Rupiah" },
  { code: "VND", label: "Vietnamese Dong" },
  { code: "MYR", label: "Malaysian Ringgit" },
  { code: "SGD", label: "Singapore Dollar" },
  { code: "CNY", label: "Chinese Yuan" },
  { code: "JPY", label: "Japanese Yen" },
  { code: "KRW", label: "Korean Won" },
  { code: "INR", label: "Indian Rupee" },

  // Americas
  { code: "CAD", label: "Canadian Dollar" },
  { code: "MXN", label: "Mexican Peso" },
  { code: "BRL", label: "Brazilian Real" },
  { code: "ARS", label: "Argentine Peso" },

  // Other
  { code: "AUD", label: "Australian Dollar" },
  { code: "NZD", label: "New Zealand Dollar" },
  { code: "EGP", label: "Egyptian Pound" },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]["code"];
export type CityCode = (typeof CITIES)[number]["code"];
export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

// Country to default currency mapping
export const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  // Balkans
  RS: "RSD",
  ME: "EUR",
  BA: "BAM",
  HR: "EUR",
  MK: "MKD",
  AL: "ALL",
  BG: "BGN",
  RO: "RON",
  SI: "EUR",

  // CIS / Post-Soviet
  RU: "RUB",
  UA: "UAH",
  BY: "BYN",
  KZ: "KZT",
  AM: "AMD",
  GE: "GEL",
  AZ: "AZN",
  UZ: "UZS",
  MD: "MDL",

  // Middle East / Asia
  TR: "TRY",
  AE: "AED",
  IL: "ILS",
  CY: "EUR",
  TH: "THB",
  ID: "IDR",
  VN: "VND",
  MY: "MYR",
  SG: "SGD",

  // Western Europe (Eurozone)
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  PT: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  IE: "EUR",

  // Non-Eurozone Europe
  GB: "GBP",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  PL: "PLN",
  CZ: "CZK",
  SK: "EUR",
  HU: "HUF",
  FI: "EUR",

  // Americas
  US: "USD",
  CA: "CAD",
  MX: "MXN",
  BR: "BRL",
  AR: "ARS",

  // Other
  AU: "AUD",
  NZ: "NZD",
  EG: "EGP",
};
