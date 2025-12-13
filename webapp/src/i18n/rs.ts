// Serbian translations
import type { Translations } from "./ru";

export const rs: Translations = {
  // Common
  loading: "Učitavanje...",
  notFound: "Nije pronađeno",
  save: "Sačuvaj",
  saving: "Čuvanje...",
  cancel: "Otkaži",
  delete: "Obriši",

  // HomePage
  mySubscriptions: "Moje pretplate",
  admin: "Admin",

  // ProductPage
  price: "Cena:",
  goToMessage: "Idi na poruku",
  analyzing: "Analiziram...",
  priceAnalysis: "Analiza cene",
  promotedUntil: "Promovisano do {date}",
  promote: "🚀 Promoviši",
  promotionOwnerOnly: "Samo autor objave može promovisati",
  promoDays3: "3 dana — 100⭐",
  promoDays7: "7 dana — 200⭐",
  promoDays30: "30 dana — 500⭐",
  photoAlt: "Slika {n}",
  previewAlt: "Pregled {n}",

  // DeepAnalysis
  verdictGood: "✅ Povoljna cena",
  verdictBad: "❌ Preskupo",
  verdictFair: "👍 OK",
  verdictUnknown: "❓",
  riskHigh: "Visok",
  riskMedium: "Srednji",
  riskLow: "Nizak",
  listingTypeSale: "Prodaja",
  listingTypeRent: "Izdavanje",
  listingTypeService: "Usluga",
  listingTypeOther: "Ostalo",
  notListing: "❌ Nije oglas",
  notListingReason: "Nije moguće odrediti tip",
  listing: "Oglas",
  riskLabel: "Rizik: {text} ({score}/100)",
  flagsLabel: "⚠️ Upozorenja:",
  itemsSection: "📋 Proizvodi/usluge",
  itemName: "Proizvod",
  itemPrice: "Cena",
  itemMarket: "Tržište",
  itemVerdict: "Ocena",
  notRecommended: "🚫 Ne preporučuje se",
  priceSources: "🔗 Izvori cena",
  overallVerdict: "📝 Rezime",
  similarInHistory: "📚 Slični u istoriji",

  // ProductList
  exactMatches: "Tačna podudaranja",
  goodMatches: "Slični",
  partialMatches: "Možda odgovara",
  nothingFound: "Ništa nije pronađeno",
  foundCount: "Pronađeno: {total}",
  exactCount: "{count} tačnih",
  goodCount: "{count} sličnih",
  partialCount: "{count} delimičnih",

  // SubscriptionList/Card
  noActiveSubscriptions: "Nema aktivnih pretplata",
  createInBot: "Kreirajte pretplatu u botu sa /new",
  positiveKeywords: "Ključne reči (+)",
  negativeKeywords: "Izuzeci (−)",
  deleteSubscription: "Obrisati pretplatu?",

  // AdminPage
  subscriptions: "Pretplate",
  noGroups: "Nema grupa",
  selectGroups: "Izaberi grupe",
  hideList: "Sakrij listu",
  noAvailableGroups: "Nema dostupnih grupa",
  totalCount: "{count} ukupno",
  activeCount: "{count} aktivnih",
  usersCount: "{count} korisnika",
  groups: "Grupe",
  showMatches: "Prikaži ({count})",
  hideMatches: "Sakrij",
  noMatches: "Nema pronađenih",

  // AnalyticsPage
  generatingAnalytics: "Generisanje analitike...",
  analyticsNotGenerated: "Analitika još nije generisana",
  autoGeneration: "Auto-generisanje u 3:00",
  generateNow: "Generiši sada",
  updatedAt: "Ažurirano: {date}",
  sellers: "Prodavaca",
  messages: "Poruka",
  foundByBot: "Bot pronašao",
  aiInsights: "AI uvidi",
  activity: "Aktivnost ({days} dana)",
  topSellers: "Top prodavci",
  categories: "Kategorije",
  prices: "Cene",
  avgPrice: "prosek: {price}",

  // SimilarProducts
  similarProducts: "Slični proizvodi",
  samePrice: "ista cena",

  // SearchBar
  searchPlaceholder: "Pretraga...",
  groupAnalytics: "Analitika grupe",

  // ProductCard (relative time)
  minutesAgo: "pre {n} min",
  hoursAgo: "pre {n} h",
  daysAgo: "pre {n} d",

  // AdminUsersPage
  loadingUsers: "Učitavanje korisnika...",
  users: "Korisnici",
  totalUsers: "{count} ukupno",
  onlineUsers: "{count} online",
  noUsersYet: "Još nema korisnika",
  never: "nikad",
  online: "online",
  secondsAgo: "pre {n}s",
  minutesAgoShort: "pre {n}m",
  hoursAgoShort: "pre {n}h",

  // AdminGroupsPage
  adminGroups: "Grupe",
  adminPresets: "Preseti",
  groupTitle: "Naziv",
  groupTitlePlaceholder: "Naziv grupe",
  groupCountry: "Država",
  groupCity: "Grad",
  groupCurrency: "Valuta",
  groupIsMarketplace: "Buvljak (prodaju se stvari)",
};
