import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAdminGroupsWithMetadata, type AdminGroupWithMetadata, type GroupMetadataUpdate } from "../hooks/useAdminGroups";
import { useTelegram } from "../hooks/useTelegram";
import { useLocale } from "../context/LocaleContext";
import type { TranslationKey } from "../i18n";
import { COUNTRIES, CITIES, CURRENCIES } from "../constants/geo";
import "./AdminGroupsPage.css";

interface GroupRowProps {
  group: AdminGroupWithMetadata;
  onUpdate: (id: number, data: GroupMetadataUpdate) => Promise<boolean>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function GroupRow({ group, onUpdate, t }: GroupRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(group.title || "");
  const [country, setCountry] = useState(group.country || "");
  const [city, setCity] = useState(group.city || "");
  const [currency, setCurrency] = useState(group.currency || "");
  const [isMarketplace, setIsMarketplace] = useState(group.is_marketplace);
  const [saving, setSaving] = useState(false);

  const hasChanges =
    title !== (group.title || "") ||
    country !== (group.country || "") ||
    city !== (group.city || "") ||
    currency !== (group.currency || "") ||
    isMarketplace !== group.is_marketplace;

  const handleSave = async () => {
    setSaving(true);
    await onUpdate(group.id, {
      title: title || undefined,
      country: country || undefined,
      city: city || undefined,
      currency: currency || undefined,
      is_marketplace: isMarketplace,
    });
    setSaving(false);
  };

  const handleReset = () => {
    setTitle(group.title || "");
    setCountry(group.country || "");
    setCity(group.city || "");
    setCurrency(group.currency || "");
    setIsMarketplace(group.is_marketplace);
  };

  // Sync state when group prop changes
  useEffect(() => {
    setTitle(group.title || "");
    setCountry(group.country || "");
    setCity(group.city || "");
    setCurrency(group.currency || "");
    setIsMarketplace(group.is_marketplace);
  }, [group]);

  const metadataFilled = group.country && group.city && group.currency;

  return (
    <div className={`admin-group-row ${metadataFilled ? "" : "incomplete"}`}>
      <div className="admin-group-header" onClick={() => setExpanded(!expanded)}>
        <div className="admin-group-title">
          {group.is_marketplace && <span className="marketplace-badge">🛒</span>}
          {group.title || `#${group.id}`}
        </div>
        <div className="admin-group-meta">
          {group.country && <span className="meta-tag">{group.country}</span>}
          {group.city && <span className="meta-tag">{group.city}</span>}
          {group.currency && <span className="meta-tag">{group.currency}</span>}
          {!metadataFilled && <span className="incomplete-badge">!</span>}
        </div>
        <span className={`expand-icon ${expanded ? "expanded" : ""}`}>▼</span>
      </div>

      {expanded && (
        <div className="admin-group-expanded">
          <div className="form-field">
            <label>{t("groupTitle")}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("groupTitlePlaceholder")}
            />
          </div>

          <div className="form-row">
            <div className="form-field">
              <label>{t("groupCountry")}</label>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                placeholder="RS, RU..."
                maxLength={2}
                list="countries-list"
              />
              <datalist id="countries-list">
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </datalist>
            </div>

            <div className="form-field">
              <label>{t("groupCity")}</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                placeholder="rs_belgrade..."
                list="cities-list"
              />
              <datalist id="cities-list">
                {CITIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label} ({c.country})</option>
                ))}
              </datalist>
            </div>

            <div className="form-field">
              <label>{t("groupCurrency")}</label>
              <input
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                placeholder="RSD, EUR..."
                maxLength={3}
                list="currencies-list"
              />
              <datalist id="currencies-list">
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </datalist>
            </div>
          </div>

          <div className="form-field checkbox-field">
            <label>
              <input
                type="checkbox"
                checked={isMarketplace}
                onChange={(e) => setIsMarketplace(e.target.checked)}
              />
              {t("groupIsMarketplace")}
            </label>
          </div>

          {hasChanges && (
            <div className="editor-actions">
              <button className="save-btn" onClick={handleSave} disabled={saving}>
                {saving ? t("saving") : t("save")}
              </button>
              <button className="reset-btn" onClick={handleReset} disabled={saving}>
                {t("cancel")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminGroupsPage() {
  const navigate = useNavigate();
  const { webApp } = useTelegram();
  const { t } = useLocale();
  const { groups, loading, error, updateGroup } = useAdminGroupsWithMetadata();

  // Setup Telegram BackButton
  useEffect(() => {
    if (!webApp) return;

    const handleBack = () => navigate("/admin");

    webApp.BackButton.show();
    webApp.BackButton.onClick(handleBack);

    return () => {
      webApp.BackButton.offClick(handleBack);
      webApp.BackButton.hide();
    };
  }, [webApp, navigate]);

  if (loading) {
    return <div className="admin-groups-page loading">{t("loading")}</div>;
  }

  if (error) {
    return <div className="admin-groups-page error">{error}</div>;
  }

  const incompleteCount = groups.filter((g) => !g.country || !g.city || !g.currency).length;
  const marketplaceCount = groups.filter((g) => g.is_marketplace).length;

  return (
    <div className="admin-groups-page">
      <div className="admin-header">
        <div className="admin-title-row">
          <h1>{t("adminGroups")}</h1>
          <Link to="/admin" className="admin-nav-link">{t("subscriptions")}</Link>
        </div>
        <div className="admin-stats">
          <span>{t("totalCount", { count: groups.length })}</span>
          <span>🛒 {marketplaceCount}</span>
          {incompleteCount > 0 && (
            <span className="incomplete-stat">⚠️ {incompleteCount}</span>
          )}
        </div>
      </div>

      <div className="admin-list">
        {groups.map((group) => (
          <GroupRow
            key={group.id}
            group={group}
            onUpdate={updateGroup}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}
