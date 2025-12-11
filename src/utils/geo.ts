/**
 * Geo normalization and fuzzy matching for countries, cities, and currencies.
 *
 * Used when collecting group metadata to normalize user input to ISO codes.
 */

// ─────────────────────────────────────────────────────────────────────────────
//                              TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ISOMatch {
  code: string;
  name: string;
  score: number;
}

interface CountryEntry {
  code: string;
  names: string[];
  defaultCurrency: string;
}

interface CityEntry {
  name: string;
  country: string;
  aliases: string[];
}

interface CurrencyEntry {
  code: string;
  names: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
//                              DICTIONARIES
// ─────────────────────────────────────────────────────────────────────────────

const COUNTRIES: CountryEntry[] = [
  // CIS / Post-Soviet
  { code: "RU", names: ["россия", "russia", "рф", "российская федерация", "росия", "русь"], defaultCurrency: "RUB" },
  { code: "UA", names: ["украина", "ukraine", "укр", "україна"], defaultCurrency: "UAH" },
  { code: "BY", names: ["беларусь", "белоруссия", "belarus", "бел", "білорусь"], defaultCurrency: "BYN" },
  { code: "KZ", names: ["казахстан", "kazakhstan", "казах", "қазақстан"], defaultCurrency: "KZT" },
  { code: "AM", names: ["армения", "armenia", "арм", "հայdelays"], defaultCurrency: "AMD" },
  { code: "GE", names: ["грузия", "georgia", "груз", "საქართველო"], defaultCurrency: "GEL" },
  { code: "AZ", names: ["азербайджан", "azerbaijan", "азер"], defaultCurrency: "AZN" },
  { code: "UZ", names: ["узбекистан", "uzbekistan", "узбек"], defaultCurrency: "UZS" },
  { code: "KG", names: ["кыргызстан", "киргизия", "kyrgyzstan", "кирг"], defaultCurrency: "KGS" },
  { code: "TJ", names: ["таджикистан", "tajikistan", "таджик"], defaultCurrency: "TJS" },
  { code: "MD", names: ["молдова", "молдавия", "moldova"], defaultCurrency: "MDL" },

  // Balkans
  { code: "RS", names: ["сербия", "serbia", "srbija", "серб"], defaultCurrency: "RSD" },
  { code: "ME", names: ["черногория", "montenegro", "crna gora", "черног"], defaultCurrency: "EUR" },
  { code: "BA", names: ["босния", "bosnia", "босния и герцеговина", "bih"], defaultCurrency: "BAM" },
  { code: "HR", names: ["хорватия", "croatia", "hrvatska"], defaultCurrency: "EUR" },
  { code: "SI", names: ["словения", "slovenia", "slovenija"], defaultCurrency: "EUR" },
  { code: "MK", names: ["македония", "северная македония", "macedonia", "makedonija"], defaultCurrency: "MKD" },
  { code: "AL", names: ["албания", "albania", "shqipëri"], defaultCurrency: "ALL" },
  { code: "BG", names: ["болгария", "bulgaria", "българия"], defaultCurrency: "BGN" },
  { code: "RO", names: ["румыния", "romania", "românia"], defaultCurrency: "RON" },

  // Western Europe
  { code: "DE", names: ["германия", "germany", "deutschland", "герм"], defaultCurrency: "EUR" },
  { code: "FR", names: ["франция", "france", "франц"], defaultCurrency: "EUR" },
  { code: "IT", names: ["италия", "italy", "italia", "итал"], defaultCurrency: "EUR" },
  { code: "ES", names: ["испания", "spain", "españa", "испан"], defaultCurrency: "EUR" },
  { code: "PT", names: ["португалия", "portugal", "португ"], defaultCurrency: "EUR" },
  { code: "NL", names: ["нидерланды", "голландия", "netherlands", "holland"], defaultCurrency: "EUR" },
  { code: "BE", names: ["бельгия", "belgium", "belgië"], defaultCurrency: "EUR" },
  { code: "AT", names: ["австрия", "austria", "österreich"], defaultCurrency: "EUR" },
  { code: "CH", names: ["швейцария", "switzerland", "schweiz", "suisse"], defaultCurrency: "CHF" },
  { code: "GB", names: ["великобритания", "англия", "uk", "england", "britain", "британия"], defaultCurrency: "GBP" },
  { code: "IE", names: ["ирландия", "ireland", "éire"], defaultCurrency: "EUR" },

  // Nordic
  { code: "SE", names: ["швеция", "sweden", "sverige"], defaultCurrency: "SEK" },
  { code: "NO", names: ["норвегия", "norway", "norge"], defaultCurrency: "NOK" },
  { code: "FI", names: ["финляндия", "finland", "suomi"], defaultCurrency: "EUR" },
  { code: "DK", names: ["дания", "denmark", "danmark"], defaultCurrency: "DKK" },

  // Eastern Europe
  { code: "PL", names: ["польша", "poland", "polska"], defaultCurrency: "PLN" },
  { code: "CZ", names: ["чехия", "czech", "česko", "чех"], defaultCurrency: "CZK" },
  { code: "SK", names: ["словакия", "slovakia", "slovensko"], defaultCurrency: "EUR" },
  { code: "HU", names: ["венгрия", "hungary", "magyarország"], defaultCurrency: "HUF" },

  // Middle East / Asia
  { code: "TR", names: ["турция", "turkey", "türkiye", "тур"], defaultCurrency: "TRY" },
  { code: "AE", names: ["оаэ", "эмираты", "дубай", "dubai", "uae", "emirates", "абу-даби"], defaultCurrency: "AED" },
  { code: "IL", names: ["израиль", "israel", "ישראל"], defaultCurrency: "ILS" },
  { code: "CY", names: ["кипр", "cyprus", "κύπρος"], defaultCurrency: "EUR" },
  { code: "TH", names: ["таиланд", "тайланд", "thailand", "тай", "ประเทศไทย"], defaultCurrency: "THB" },
  { code: "ID", names: ["индонезия", "indonesia", "бали", "bali"], defaultCurrency: "IDR" },
  { code: "VN", names: ["вьетнам", "vietnam", "việt nam"], defaultCurrency: "VND" },
  { code: "MY", names: ["малайзия", "malaysia"], defaultCurrency: "MYR" },
  { code: "SG", names: ["сингапур", "singapore"], defaultCurrency: "SGD" },
  { code: "CN", names: ["китай", "china", "中国"], defaultCurrency: "CNY" },
  { code: "JP", names: ["япония", "japan", "日本"], defaultCurrency: "JPY" },
  { code: "KR", names: ["корея", "южная корея", "korea", "south korea", "한국"], defaultCurrency: "KRW" },
  { code: "IN", names: ["индия", "india", "भारत"], defaultCurrency: "INR" },

  // Americas
  { code: "US", names: ["сша", "америка", "usa", "united states", "штаты"], defaultCurrency: "USD" },
  { code: "CA", names: ["канада", "canada"], defaultCurrency: "CAD" },
  { code: "MX", names: ["мексика", "mexico", "méxico"], defaultCurrency: "MXN" },
  { code: "BR", names: ["бразилия", "brazil", "brasil"], defaultCurrency: "BRL" },
  { code: "AR", names: ["аргентина", "argentina"], defaultCurrency: "ARS" },

  // Other
  { code: "AU", names: ["австралия", "australia"], defaultCurrency: "AUD" },
  { code: "NZ", names: ["новая зеландия", "new zealand"], defaultCurrency: "NZD" },
  { code: "ZA", names: ["южная африка", "south africa", "юар"], defaultCurrency: "ZAR" },
  { code: "EG", names: ["египет", "egypt", "مصر"], defaultCurrency: "EGP" },
];

const CITIES: CityEntry[] = [
  // Russia
  { name: "москва", country: "RU", aliases: ["moscow", "msk", "мск"] },
  { name: "санкт-петербург", country: "RU", aliases: ["питер", "спб", "saint petersburg", "petersburg", "st. petersburg"] },
  { name: "новосибирск", country: "RU", aliases: ["novosibirsk", "нск"] },
  { name: "екатеринбург", country: "RU", aliases: ["ekaterinburg", "екб"] },
  { name: "казань", country: "RU", aliases: ["kazan"] },
  { name: "нижний новгород", country: "RU", aliases: ["nizhny novgorod", "нн"] },
  { name: "сочи", country: "RU", aliases: ["sochi"] },
  { name: "краснодар", country: "RU", aliases: ["krasnodar"] },
  { name: "ростов-на-дону", country: "RU", aliases: ["rostov", "ростов"] },
  { name: "владивосток", country: "RU", aliases: ["vladivostok"] },

  // Serbia
  { name: "белград", country: "RS", aliases: ["belgrade", "beograd", "београд"] },
  { name: "нови сад", country: "RS", aliases: ["novi sad", "нови-сад"] },
  { name: "ниш", country: "RS", aliases: ["nis", "niš"] },

  // Montenegro
  { name: "подгорица", country: "ME", aliases: ["podgorica"] },
  { name: "будва", country: "ME", aliases: ["budva"] },
  { name: "бар", country: "ME", aliases: ["bar"] },
  { name: "тиват", country: "ME", aliases: ["tivat"] },

  // Georgia
  { name: "тбилиси", country: "GE", aliases: ["tbilisi", "თბილისი"] },
  { name: "батуми", country: "GE", aliases: ["batumi", "ბათუმი"] },

  // Armenia
  { name: "ереван", country: "AM", aliases: ["yerevan", "երdelays"] },

  // Turkey
  { name: "стамбул", country: "TR", aliases: ["istanbul", "İstanbul"] },
  { name: "анталья", country: "TR", aliases: ["antalya"] },
  { name: "анкара", country: "TR", aliases: ["ankara"] },
  { name: "измир", country: "TR", aliases: ["izmir"] },

  // UAE
  { name: "дубай", country: "AE", aliases: ["dubai", "دبي"] },
  { name: "абу-даби", country: "AE", aliases: ["abu dhabi", "أبو ظبي"] },

  // Thailand
  { name: "бангкок", country: "TH", aliases: ["bangkok", "กรุงเทพ"] },
  { name: "пхукет", country: "TH", aliases: ["phuket", "ภูเก็ต"] },
  { name: "паттайя", country: "TH", aliases: ["pattaya", "พัทยา"] },
  { name: "чиангмай", country: "TH", aliases: ["chiang mai", "เชียงใหม่"] },

  // Indonesia
  { name: "бали", country: "ID", aliases: ["bali"] },
  { name: "джакарта", country: "ID", aliases: ["jakarta"] },

  // Kazakhstan
  { name: "алматы", country: "KZ", aliases: ["almaty", "алма-ата"] },
  { name: "астана", country: "KZ", aliases: ["astana", "нур-султан"] },

  // Ukraine
  { name: "киев", country: "UA", aliases: ["kyiv", "kiev", "київ"] },
  { name: "одесса", country: "UA", aliases: ["odessa", "одеса"] },
  { name: "харьков", country: "UA", aliases: ["kharkiv", "харків"] },
  { name: "львов", country: "UA", aliases: ["lviv", "львів"] },

  // Belarus
  { name: "минск", country: "BY", aliases: ["minsk", "мінск"] },

  // Germany
  { name: "берлин", country: "DE", aliases: ["berlin"] },
  { name: "мюнхен", country: "DE", aliases: ["munich", "münchen"] },
  { name: "франкфурт", country: "DE", aliases: ["frankfurt"] },
  { name: "гамбург", country: "DE", aliases: ["hamburg"] },

  // Other European capitals
  { name: "париж", country: "FR", aliases: ["paris"] },
  { name: "лондон", country: "GB", aliases: ["london"] },
  { name: "амстердам", country: "NL", aliases: ["amsterdam"] },
  { name: "барселона", country: "ES", aliases: ["barcelona"] },
  { name: "мадрид", country: "ES", aliases: ["madrid"] },
  { name: "рим", country: "IT", aliases: ["rome", "roma"] },
  { name: "милан", country: "IT", aliases: ["milan", "milano"] },
  { name: "прага", country: "CZ", aliases: ["prague", "praha"] },
  { name: "варшава", country: "PL", aliases: ["warsaw", "warszawa"] },
  { name: "вена", country: "AT", aliases: ["vienna", "wien"] },
  { name: "лиссабон", country: "PT", aliases: ["lisbon", "lisboa"] },

  // Cyprus
  { name: "лимассол", country: "CY", aliases: ["limassol", "λεμεσός"] },
  { name: "ларнака", country: "CY", aliases: ["larnaca", "λάρνακα"] },
  { name: "никосия", country: "CY", aliases: ["nicosia", "λευκωσία"] },
  { name: "пафос", country: "CY", aliases: ["paphos", "πάφος"] },

  // Americas
  { name: "нью-йорк", country: "US", aliases: ["new york", "nyc", "ny"] },
  { name: "лос-анджелес", country: "US", aliases: ["los angeles", "la"] },
  { name: "майами", country: "US", aliases: ["miami"] },
];

const CURRENCIES: CurrencyEntry[] = [
  // Major
  { code: "USD", names: ["доллар", "usd", "$", "бакс", "dollar", "доллары", "долларов", "баксов"] },
  { code: "EUR", names: ["евро", "eur", "€", "euro", "еврики"] },
  { code: "GBP", names: ["фунт", "gbp", "£", "pound", "фунты", "фунтов"] },

  // CIS
  { code: "RUB", names: ["рубль", "руб", "rub", "₽", "рублей", "р", "рубли", "рублик"] },
  { code: "UAH", names: ["гривна", "uah", "грн", "₴", "hryvnia", "гривны", "гривень"] },
  { code: "BYN", names: ["белорусский рубль", "byn", "бел.руб", "бел руб", "белруб"] },
  { code: "KZT", names: ["тенге", "kzt", "₸", "tenge"] },
  { code: "AMD", names: ["драм", "amd", "֏", "dram", "драмы", "драмов"] },
  { code: "GEL", names: ["лари", "gel", "₾", "lari"] },
  { code: "AZN", names: ["манат", "azn", "₼", "manat"] },
  { code: "UZS", names: ["сум", "uzs", "сўм", "sum"] },
  { code: "MDL", names: ["лей", "mdl", "молдавский лей"] },

  // Balkans
  { code: "RSD", names: ["динар", "дин", "din", "rsd", "dinar", "динары", "динаров", "динара"] },
  { code: "BAM", names: ["марка", "bam", "км", "конвертируемая марка"] },
  { code: "MKD", names: ["денар", "mkd", "denar"] },
  { code: "ALL", names: ["лек", "all", "lek"] },
  { code: "BGN", names: ["лев", "bgn", "лева"] },
  { code: "RON", names: ["румынский лей", "ron", "lei"] },

  // Other European
  { code: "CHF", names: ["франк", "chf", "швейцарский франк", "franc"] },
  { code: "PLN", names: ["злотый", "pln", "zł", "злотых", "zloty"] },
  { code: "CZK", names: ["крона", "czk", "kč", "чешская крона", "koruna"] },
  { code: "HUF", names: ["форинт", "huf", "ft", "forint"] },
  { code: "SEK", names: ["шведская крона", "sek", "kr"] },
  { code: "NOK", names: ["норвежская крона", "nok"] },
  { code: "DKK", names: ["датская крона", "dkk"] },

  // Middle East / Asia
  { code: "TRY", names: ["лира", "try", "tl", "₺", "турецкая лира", "лиры", "лир"] },
  { code: "AED", names: ["дирхам", "aed", "د.إ", "dirham", "дирхамы", "дирхамов"] },
  { code: "ILS", names: ["шекель", "ils", "₪", "shekel", "шекели"] },
  { code: "THB", names: ["бат", "thb", "฿", "baht", "баты", "батов"] },
  { code: "IDR", names: ["рупия", "idr", "индонезийская рупия", "rupiah"] },
  { code: "VND", names: ["донг", "vnd", "₫", "dong"] },
  { code: "MYR", names: ["ринггит", "myr", "rm", "ringgit"] },
  { code: "SGD", names: ["сингапурский доллар", "sgd", "s$"] },
  { code: "CNY", names: ["юань", "cny", "¥", "yuan", "rmb", "жэньминьби"] },
  { code: "JPY", names: ["йена", "jpy", "¥", "иена", "yen"] },
  { code: "KRW", names: ["вона", "krw", "₩", "won", "воны"] },
  { code: "INR", names: ["рупия", "inr", "₹", "индийская рупия", "rupee"] },

  // Americas
  { code: "CAD", names: ["канадский доллар", "cad", "c$"] },
  { code: "MXN", names: ["песо", "mxn", "мексиканское песо"] },
  { code: "BRL", names: ["реал", "brl", "r$", "бразильский реал"] },
  { code: "ARS", names: ["аргентинское песо", "ars"] },

  // Other
  { code: "AUD", names: ["австралийский доллар", "aud", "a$"] },
  { code: "NZD", names: ["новозеландский доллар", "nzd", "nz$"] },
  { code: "ZAR", names: ["ранд", "zar", "южноафриканский ранд"] },
  { code: "EGP", names: ["египетский фунт", "egp", "e£"] },
];

// ─────────────────────────────────────────────────────────────────────────────
//                           MATCHING FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fuzzy match user input to ISO country code
 */
export function matchCountry(input: string): ISOMatch | null {
  const normalized = input.toLowerCase().trim();
  if (!normalized) return null;

  let bestMatch: ISOMatch | null = null;
  let bestScore = 0;

  for (const entry of COUNTRIES) {
    for (const name of entry.names) {
      const score = calculateMatchScore(normalized, name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { code: entry.code, name, score };
      }
    }
  }

  // Only return if score is high enough
  return bestScore >= 0.5 ? bestMatch : null;
}

/**
 * Fuzzy match user input to ISO currency code
 */
export function matchCurrency(input: string): ISOMatch | null {
  const normalized = input.toLowerCase().trim();
  if (!normalized) return null;

  let bestMatch: ISOMatch | null = null;
  let bestScore = 0;

  for (const entry of CURRENCIES) {
    for (const name of entry.names) {
      const score = calculateMatchScore(normalized, name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { code: entry.code, name, score };
      }
    }
  }

  return bestScore >= 0.5 ? bestMatch : null;
}

/**
 * Match user input to a city and return its country
 */
export function matchCity(input: string): { city: string; country: string; score: number } | null {
  const normalized = input.toLowerCase().trim();
  if (!normalized) return null;

  let bestMatch: { city: string; country: string; score: number } | null = null;
  let bestScore = 0;

  for (const entry of CITIES) {
    // Check main name
    let score = calculateMatchScore(normalized, entry.name);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { city: entry.name, country: entry.country, score };
    }

    // Check aliases
    for (const alias of entry.aliases) {
      score = calculateMatchScore(normalized, alias);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { city: entry.name, country: entry.country, score };
      }
    }
  }

  return bestScore >= 0.5 ? bestMatch : null;
}

/**
 * Get default currency for a country
 */
export function getDefaultCurrency(countryCode: string): string | null {
  const country = COUNTRIES.find((c) => c.code === countryCode);
  return country?.defaultCurrency ?? null;
}

/**
 * Get human-readable country name in Russian
 */
export function getCountryName(code: string): string {
  const country = COUNTRIES.find((c) => c.code === code);
  if (!country) return code;
  // Return first Russian name (capitalized)
  const name = country.names[0] ?? code;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Get human-readable currency name in Russian
 */
export function getCurrencyName(code: string): string {
  const currency = CURRENCIES.find((c) => c.code === code);
  if (!currency) return code;
  const name = currency.names[0] ?? code;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Parse group title to extract country and city hints
 */
export function parseGroupTitle(title: string): { country?: string; city?: string } {
  const normalized = title.toLowerCase();
  const result: { country?: string; city?: string } = {};

  // First, try to find a city (which gives us country too)
  for (const cityEntry of CITIES) {
    const allNames = [cityEntry.name, ...cityEntry.aliases];
    for (const name of allNames) {
      if (normalized.includes(name)) {
        result.city = cityEntry.name.charAt(0).toUpperCase() + cityEntry.name.slice(1);
        result.country = cityEntry.country;
        return result; // City found, we have country too
      }
    }
  }

  // No city found, try to find country
  for (const countryEntry of COUNTRIES) {
    for (const name of countryEntry.names) {
      if (normalized.includes(name)) {
        result.country = countryEntry.code;
        return result;
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
//                           INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate match score between user input and dictionary entry
 * Returns 1.0 for exact match, lower scores for partial matches
 */
function calculateMatchScore(input: string, target: string): number {
  // Exact match
  if (input === target) {
    return 1.0;
  }

  // Prefix match (user typed beginning of the word)
  if (target.startsWith(input) && input.length >= 2) {
    return 0.8 + (input.length / target.length) * 0.2;
  }

  // Target is prefix of input (user typed more)
  if (input.startsWith(target) && target.length >= 2) {
    return 0.7;
  }

  // Trigram similarity for fuzzy matching (handles typos)
  return trigramSimilarity(input, target);
}

/**
 * Jaccard similarity using character trigrams
 */
function trigramSimilarity(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) {
    // For short strings, use containment check
    if (a.length < b.length && b.includes(a)) return 0.6;
    if (b.length < a.length && a.includes(b)) return 0.6;
    return 0;
  }

  const aNgrams = new Set<string>();
  const bNgrams = new Set<string>();

  for (let i = 0; i <= a.length - 3; i++) {
    aNgrams.add(a.slice(i, i + 3));
  }
  for (let i = 0; i <= b.length - 3; i++) {
    bNgrams.add(b.slice(i, i + 3));
  }

  let intersection = 0;
  for (const ng of aNgrams) {
    if (bNgrams.has(ng)) intersection++;
  }

  const union = aNgrams.size + bNgrams.size - intersection;
  return union > 0 ? intersection / union : 0;
}
