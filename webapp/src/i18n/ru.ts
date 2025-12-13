// Russian translations (base file with types)

export const ru = {
  // Common
  loading: "Загрузка...",
  notFound: "Не найдено",
  save: "Сохранить",
  saving: "Сохранение...",
  cancel: "Отмена",
  delete: "Удалить",

  // HomePage
  mySubscriptions: "Мои подписки",
  admin: "Админ",

  // ProductPage
  price: "Цена:",
  goToMessage: "Перейти к сообщению",
  analyzing: "Анализирую...",
  priceAnalysis: "Анализ цены",
  promotedUntil: "Продвигается до {date}",
  promote: "🚀 Продвинуть",
  promotionOwnerOnly: "Продвижение доступно только автору поста",
  promoDays3: "3 дня — 100⭐",
  promoDays7: "7 дней — 200⭐",
  promoDays30: "30 дней — 500⭐",
  photoAlt: "Фото {n}",
  previewAlt: "Превью {n}",

  // DeepAnalysis
  verdictGood: "✅ Выгодно",
  verdictBad: "❌ Дорого",
  verdictFair: "👍 Норм",
  verdictUnknown: "❓",
  riskHigh: "Высокий",
  riskMedium: "Средний",
  riskLow: "Низкий",
  listingTypeSale: "Продажа",
  listingTypeRent: "Аренда",
  listingTypeService: "Услуга",
  listingTypeOther: "Другое",
  notListing: "❌ Это не объявление",
  notListingReason: "Не удалось определить тип",
  listing: "Объявление",
  riskLabel: "Риск: {text} ({score}/100)",
  flagsLabel: "⚠️ Флаги:",
  itemsSection: "📋 Товары/услуги",
  itemName: "Товар",
  itemPrice: "Цена",
  itemMarket: "Рынок",
  itemVerdict: "Оценка",
  notRecommended: "🚫 Не рекомендуется",
  priceSources: "🔗 Источники цен",
  overallVerdict: "📝 Итог",
  similarInHistory: "📚 Похожие в истории",

  // ProductList
  exactMatches: "Точные совпадения",
  goodMatches: "Похожие",
  partialMatches: "Возможно подходит",
  nothingFound: "Ничего не найдено",
  foundCount: "Найдено: {total}",
  exactCount: "{count} точных",
  goodCount: "{count} похожих",
  partialCount: "{count} частичных",

  // SubscriptionList/Card
  noActiveSubscriptions: "Нет активных подписок",
  createInBot: "Создайте подписку в боте командой /new",
  positiveKeywords: "Ключевые слова (+)",
  negativeKeywords: "Исключения (−)",
  deleteSubscription: "Удалить подписку?",

  // AdminPage
  subscriptions: "Подписки",
  noGroups: "Нет групп",
  selectGroups: "Выбрать группы",
  hideList: "Скрыть список",
  noAvailableGroups: "Нет доступных групп",
  totalCount: "{count} всего",
  activeCount: "{count} активных",
  usersCount: "{count} пользователей",
  groups: "Группы",
  showMatches: "Показать ({count})",
  hideMatches: "Скрыть",
  noMatches: "Совпадений нет",

  // AnalyticsPage
  generatingAnalytics: "Генерация аналитики...",
  analyticsNotGenerated: "Аналитика пока не сгенерирована",
  autoGeneration: "Автоматическая генерация в 3:00",
  generateNow: "Сгенерировать сейчас",
  updatedAt: "Обновлено: {date}",
  sellers: "Продавцов",
  messages: "Сообщений",
  foundByBot: "Найдено ботом",
  aiInsights: "AI-инсайты",
  activity: "Активность ({days} дн.)",
  topSellers: "Топ продавцов",
  categories: "Категории",
  prices: "Цены",
  avgPrice: "сред: {price}",

  // SimilarProducts
  similarProducts: "Похожие товары",
  samePrice: "такая же цена",

  // SearchBar
  searchPlaceholder: "Поиск...",
  groupAnalytics: "Аналитика группы",

  // ProductCard (relative time)
  minutesAgo: "{n} мин назад",
  hoursAgo: "{n} ч назад",
  daysAgo: "{n} дн назад",

  // AdminUsersPage
  loadingUsers: "Загрузка пользователей...",
  users: "Пользователи",
  totalUsers: "{count} всего",
  onlineUsers: "{count} онлайн",
  noUsersYet: "Пользователей пока нет",
  never: "никогда",
  online: "онлайн",
  secondsAgo: "{n}с назад",
  minutesAgoShort: "{n}м назад",
  hoursAgoShort: "{n}ч назад",

  // AdminGroupsPage
  adminGroups: "Группы",
  adminPresets: "Пресеты",
  groupTitle: "Название",
  groupTitlePlaceholder: "Название группы",
  groupCountry: "Страна",
  groupCity: "Город",
  groupCurrency: "Валюта",
  groupIsMarketplace: "Барахолка (продают товары)",
} as const;

export type TranslationKey = keyof typeof ru;
export type Translations = Record<TranslationKey, string>;
