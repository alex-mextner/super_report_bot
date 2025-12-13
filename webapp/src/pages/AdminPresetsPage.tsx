import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAdminPresets, type Preset, type AvailableGroup } from "../hooks/useAdminPresets";
import { useTelegram } from "../hooks/useTelegram";
import { useLocale } from "../context/LocaleContext";
import "./AdminPresetsPage.css";

interface PresetRowProps {
  preset: Preset;
  cities: string[];
  onUpdate: (id: number, data: { region_code?: string; region_name?: string; country_code?: string | null; currency?: string | null }) => Promise<boolean>;
  onDelete: (id: number) => Promise<boolean>;
  onAddGroup: (presetId: number, groupId: number) => Promise<boolean>;
  onRemoveGroup: (presetId: number, groupId: number) => Promise<boolean>;
  getAvailableGroups: (presetId: number, cityFilter?: string) => Promise<AvailableGroup[]>;
}

function PresetRow({ preset, cities, onUpdate, onDelete, onAddGroup, onRemoveGroup, getAvailableGroups }: PresetRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [availableGroups, setAvailableGroups] = useState<AvailableGroup[]>([]);
  const [cityFilter, setCityFilter] = useState<string>(preset.region_code);
  const [loadingGroups, setLoadingGroups] = useState(false);

  // Edit form state
  const [regionCode, setRegionCode] = useState(preset.region_code);
  const [regionName, setRegionName] = useState(preset.region_name);
  const [countryCode, setCountryCode] = useState(preset.country_code || "");
  const [currency, setCurrency] = useState(preset.currency || "");
  const [saving, setSaving] = useState(false);

  const loadAvailableGroups = async (filter?: string) => {
    setLoadingGroups(true);
    const groups = await getAvailableGroups(preset.id, filter);
    setAvailableGroups(groups);
    setLoadingGroups(false);
  };

  const handleExpand = () => {
    setExpanded(!expanded);
    if (!expanded) {
      setShowAddGroup(false);
      setEditMode(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await onUpdate(preset.id, {
      region_code: regionCode,
      region_name: regionName,
      country_code: countryCode || null,
      currency: currency || null,
    });
    setSaving(false);
    setEditMode(false);
  };

  const handleDelete = async () => {
    if (confirm(`Delete preset "${preset.region_name}"?`)) {
      await onDelete(preset.id);
    }
  };

  const handleShowAddGroup = async () => {
    setShowAddGroup(true);
    setCityFilter(preset.region_code);
    await loadAvailableGroups(preset.region_code);
  };

  const handleCityFilterChange = async (newFilter: string) => {
    setCityFilter(newFilter);
    await loadAvailableGroups(newFilter || undefined);
  };

  const handleAddGroup = async (groupId: number) => {
    await onAddGroup(preset.id, groupId);
    await loadAvailableGroups(cityFilter || undefined);
  };

  const handleRemoveGroup = async (groupId: number) => {
    await onRemoveGroup(preset.id, groupId);
  };

  // Sync state when preset changes
  useEffect(() => {
    setRegionCode(preset.region_code);
    setRegionName(preset.region_name);
    setCountryCode(preset.country_code || "");
    setCurrency(preset.currency || "");
  }, [preset]);

  return (
    <div className="preset-row">
      <div className="preset-header" onClick={handleExpand}>
        <div className="preset-info">
          <span className="preset-icon">📂</span>
          <span className="preset-name">{preset.region_name}</span>
          <span className="preset-code">{preset.region_code}</span>
        </div>
        <div className="preset-meta">
          <span className="group-count">{preset.group_count} groups</span>
          {preset.country_code && <span className="meta-tag">{preset.country_code}</span>}
          {preset.currency && <span className="meta-tag">{preset.currency}</span>}
        </div>
        <span className={`expand-icon ${expanded ? "expanded" : ""}`}>▼</span>
      </div>

      {expanded && (
        <div className="preset-expanded">
          {/* Edit mode */}
          {editMode ? (
            <div className="preset-edit-form">
              <div className="form-row">
                <div className="form-field">
                  <label>Region Code</label>
                  <input
                    type="text"
                    value={regionCode}
                    onChange={(e) => setRegionCode(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                    placeholder="rs_belgrade"
                  />
                </div>
                <div className="form-field">
                  <label>Region Name</label>
                  <input
                    type="text"
                    value={regionName}
                    onChange={(e) => setRegionName(e.target.value)}
                    placeholder="Барахолки Белграда"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-field">
                  <label>Country Code</label>
                  <input
                    type="text"
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
                    placeholder="RS"
                    maxLength={2}
                  />
                </div>
                <div className="form-field">
                  <label>Currency</label>
                  <input
                    type="text"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    placeholder="EUR"
                    maxLength={3}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button className="save-btn" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </button>
                <button className="cancel-btn" onClick={() => setEditMode(false)}>Cancel</button>
                <button className="delete-btn" onClick={handleDelete}>Delete Preset</button>
              </div>
            </div>
          ) : (
            <div className="preset-actions-bar">
              <button className="edit-btn" onClick={() => setEditMode(true)}>Edit Preset</button>
              <button className="add-group-btn" onClick={handleShowAddGroup}>Add Groups</button>
            </div>
          )}

          {/* Groups in preset */}
          <div className="preset-groups">
            <h4>Groups in preset ({preset.groups.length})</h4>
            {preset.groups.length === 0 ? (
              <div className="no-groups">No groups in this preset</div>
            ) : (
              <div className="groups-list">
                {preset.groups.map((group) => (
                  <div key={group.id} className="group-item">
                    <span className="group-title">{group.title || `#${group.id}`}</span>
                    {group.city && <span className="group-city">{group.city}</span>}
                    <button className="remove-btn" onClick={() => handleRemoveGroup(group.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add groups panel */}
          {showAddGroup && (
            <div className="add-groups-panel">
              <h4>Add Groups</h4>
              <div className="city-filter">
                <label>Filter by city:</label>
                <select value={cityFilter} onChange={(e) => handleCityFilterChange(e.target.value)}>
                  <option value="">All cities</option>
                  {cities.map((city) => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
              </div>
              {loadingGroups ? (
                <div className="loading">Loading...</div>
              ) : availableGroups.length === 0 ? (
                <div className="no-groups">No available groups{cityFilter ? ` for ${cityFilter}` : ""}</div>
              ) : (
                <div className="available-groups-list">
                  {availableGroups.map((group) => (
                    <div key={group.id} className="available-group-item">
                      <span className="group-title">{group.title || `#${group.id}`}</span>
                      {group.city && <span className="group-city">{group.city}</span>}
                      <button className="add-btn" onClick={() => handleAddGroup(group.id)}>+</button>
                    </div>
                  ))}
                </div>
              )}
              <button className="close-btn" onClick={() => setShowAddGroup(false)}>Close</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CreatePresetFormProps {
  cities: string[];
  onCreate: (data: { region_code: string; region_name: string; country_code?: string; currency?: string }) => Promise<number | null>;
  onCancel: () => void;
}

function CreatePresetForm({ cities, onCreate, onCancel }: CreatePresetFormProps) {
  const [regionCode, setRegionCode] = useState("");
  const [regionName, setRegionName] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [currency, setCurrency] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!regionCode || !regionName) return;
    setSaving(true);
    await onCreate({
      region_code: regionCode,
      region_name: regionName,
      country_code: countryCode || undefined,
      currency: currency || undefined,
    });
    setSaving(false);
    onCancel();
  };

  return (
    <div className="create-preset-form">
      <h3>Create New Preset</h3>
      <div className="form-row">
        <div className="form-field">
          <label>Region Code *</label>
          <input
            type="text"
            value={regionCode}
            onChange={(e) => setRegionCode(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
            placeholder="rs_belgrade"
            list="cities-list"
          />
          <datalist id="cities-list">
            {cities.map((city) => (
              <option key={city} value={city} />
            ))}
          </datalist>
        </div>
        <div className="form-field">
          <label>Region Name *</label>
          <input
            type="text"
            value={regionName}
            onChange={(e) => setRegionName(e.target.value)}
            placeholder="Барахолки Белграда"
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field">
          <label>Country Code</label>
          <input
            type="text"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            placeholder="RS"
            maxLength={2}
          />
        </div>
        <div className="form-field">
          <label>Currency</label>
          <input
            type="text"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            placeholder="EUR"
            maxLength={3}
          />
        </div>
      </div>
      <div className="form-actions">
        <button className="save-btn" onClick={handleSubmit} disabled={saving || !regionCode || !regionName}>
          {saving ? "Creating..." : "Create"}
        </button>
        <button className="cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function AdminPresetsPage() {
  const navigate = useNavigate();
  const { webApp } = useTelegram();
  const { t } = useLocale();
  const {
    presets,
    cities,
    loading,
    error,
    createPreset,
    updatePreset,
    deletePreset,
    getAvailableGroups,
    addGroupToPreset,
    removeGroupFromPreset,
  } = useAdminPresets();

  const [showCreateForm, setShowCreateForm] = useState(false);

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
    return <div className="admin-presets-page loading">{t("loading")}</div>;
  }

  if (error) {
    return <div className="admin-presets-page error">{error}</div>;
  }

  const totalGroups = presets.reduce((sum, p) => sum + p.group_count, 0);

  return (
    <div className="admin-presets-page">
      <div className="admin-header">
        <div className="admin-title-row">
          <h1>Presets</h1>
          <Link to="/admin" className="admin-nav-link">Subscriptions</Link>
        </div>
        <div className="admin-stats">
          <span>{presets.length} presets</span>
          <span>{totalGroups} total groups</span>
        </div>
      </div>

      <div className="create-preset-section">
        {showCreateForm ? (
          <CreatePresetForm
            cities={cities}
            onCreate={createPreset}
            onCancel={() => setShowCreateForm(false)}
          />
        ) : (
          <button className="create-preset-btn" onClick={() => setShowCreateForm(true)}>
            + Create Preset
          </button>
        )}
      </div>

      <div className="presets-list">
        {presets.map((preset) => (
          <PresetRow
            key={preset.id}
            preset={preset}
            cities={cities}
            onUpdate={updatePreset}
            onDelete={deletePreset}
            onAddGroup={addGroupToPreset}
            onRemoveGroup={removeGroupFromPreset}
            getAvailableGroups={getAvailableGroups}
          />
        ))}
      </div>
    </div>
  );
}
