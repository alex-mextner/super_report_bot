// English translations
import type { Translations } from "./ru";

export const en: Translations = {
  // Common
  loading: "Loading...",
  notFound: "Not found",
  save: "Save",
  saving: "Saving...",
  cancel: "Cancel",
  delete: "Delete",

  // HomePage
  mySubscriptions: "My subscriptions",
  admin: "Admin",

  // ProductPage
  price: "Price:",
  goToMessage: "Go to message",
  analyzing: "Analyzing...",
  priceAnalysis: "Price analysis",
  promotedUntil: "Promoted until {date}",
  promote: "🚀 Promote",
  promotionOwnerOnly: "Only post author can promote",
  promoDays3: "3 days — 100⭐",
  promoDays7: "7 days — 200⭐",
  promoDays30: "30 days — 500⭐",
  photoAlt: "Photo {n}",
  previewAlt: "Preview {n}",

  // DeepAnalysis
  verdictGood: "✅ Good deal",
  verdictBad: "❌ Overpriced",
  verdictFair: "👍 Fair",
  verdictUnknown: "❓",
  riskHigh: "High",
  riskMedium: "Medium",
  riskLow: "Low",
  listingTypeSale: "Sale",
  listingTypeRent: "Rent",
  listingTypeService: "Service",
  listingTypeOther: "Other",
  notListing: "❌ Not a listing",
  notListingReason: "Could not determine type",
  listing: "Listing",
  riskLabel: "Risk: {text} ({score}/100)",
  flagsLabel: "⚠️ Flags:",
  itemsSection: "📋 Items/services",
  itemName: "Item",
  itemPrice: "Price",
  itemMarket: "Market",
  itemVerdict: "Verdict",
  notRecommended: "🚫 Not recommended",
  priceSources: "🔗 Price sources",
  overallVerdict: "📝 Summary",
  similarInHistory: "📚 Similar in history",

  // ProductList
  exactMatches: "Exact matches",
  goodMatches: "Similar",
  partialMatches: "May match",
  nothingFound: "Nothing found",
  foundCount: "Found: {total}",
  exactCount: "{count} exact",
  goodCount: "{count} similar",
  partialCount: "{count} partial",

  // SubscriptionList/Card
  noActiveSubscriptions: "No active subscriptions",
  createInBot: "Create a subscription in bot with /new",
  positiveKeywords: "Keywords (+)",
  negativeKeywords: "Exclusions (−)",
  deleteSubscription: "Delete subscription?",

  // AdminPage
  subscriptions: "Subscriptions",
  noGroups: "No groups",
  selectGroups: "Select groups",
  hideList: "Hide list",
  noAvailableGroups: "No available groups",
  totalCount: "{count} total",
  activeCount: "{count} active",
  usersCount: "{count} users",
  groups: "Groups",
  showMatches: "Show matches ({count})",
  hideMatches: "Hide matches",
  noMatches: "No matches found",

  // AnalyticsPage
  generatingAnalytics: "Generating analytics...",
  analyticsNotGenerated: "Analytics not generated yet",
  autoGeneration: "Auto-generation at 3:00 AM",
  generateNow: "Generate now",
  updatedAt: "Updated: {date}",
  sellers: "Sellers",
  messages: "Messages",
  foundByBot: "Found by bot",
  aiInsights: "AI Insights",
  activity: "Activity ({days} days)",
  topSellers: "Top sellers",
  categories: "Categories",
  prices: "Prices",
  avgPrice: "avg: {price}",

  // SimilarProducts
  similarProducts: "Similar products",
  samePrice: "same price",

  // SearchBar
  searchPlaceholder: "Search...",
  groupAnalytics: "Group analytics",

  // ProductCard (relative time)
  minutesAgo: "{n} min ago",
  hoursAgo: "{n} h ago",
  daysAgo: "{n} d ago",

  // AdminUsersPage
  loadingUsers: "Loading users...",
  users: "Users",
  totalUsers: "{count} total",
  onlineUsers: "{count} online",
  noUsersYet: "No users yet",
  never: "never",
  online: "online",
  secondsAgo: "{n}s ago",
  minutesAgoShort: "{n}m ago",
  hoursAgoShort: "{n}h ago",

  // AdminGroupsPage
  adminGroups: "Groups",
  adminPresets: "Presets",
  groupTitle: "Title",
  groupTitlePlaceholder: "Group name",
  groupCountry: "Country",
  groupCity: "City",
  groupCurrency: "Currency",
  groupIsMarketplace: "Marketplace (items for sale)",
};
