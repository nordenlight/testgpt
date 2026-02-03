const API_URL = "https://api.opsucht.net/auctions/active";
const MOJANG_URL = "https://sessionserver.mojang.com/session/minecraft/profile";
const NAME_CACHE_KEY = "opsucht-name-cache-v1";

const elements = {
  status: document.getElementById("status"),
  grid: document.getElementById("auction-grid"),
  count: document.getElementById("auction-count"),
  lastUpdated: document.getElementById("last-updated"),
  refresh: document.getElementById("refresh"),
  search: document.getElementById("search"),
};

const nameCache = new Map(Object.entries(loadNameCache()));
let auctions = [];

const formatPrice = (value) => {
  if (typeof value === "number") {
    return new Intl.NumberFormat("de-DE").format(value);
  }
  return value ?? "–";
};

const normalizeUuid = (uuid) => {
  if (!uuid) return null;
  const cleaned = uuid.replace(/-/g, "");
  return cleaned.length === 32
    ? `${cleaned.slice(0, 8)}-${cleaned.slice(8, 12)}-${cleaned.slice(12, 16)}-${cleaned.slice(16, 20)}-${cleaned.slice(20)}`
    : uuid;
};

const loadNameCache = () => {
  try {
    const raw = localStorage.getItem(NAME_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
};

const persistNameCache = () => {
  const payload = Object.fromEntries(nameCache.entries());
  localStorage.setItem(NAME_CACHE_KEY, JSON.stringify(payload));
};

const updateStatus = (message, tone = "info") => {
  if (!message) {
    elements.status.classList.remove("visible");
    elements.status.textContent = "";
    return;
  }
  elements.status.classList.add("visible");
  elements.status.textContent = message;
  elements.status.dataset.tone = tone;
};

const resolveUuidName = async (uuid) => {
  const normalized = normalizeUuid(uuid);
  if (!normalized) return "Unbekannt";
  if (nameCache.has(normalized)) {
    return nameCache.get(normalized);
  }

  try {
    const response = await fetch(`${MOJANG_URL}/${normalized.replace(/-/g, "")}`);
    if (!response.ok) throw new Error("Name lookup failed");
    const data = await response.json();
    if (data?.name) {
      nameCache.set(normalized, data.name);
      persistNameCache();
      return data.name;
    }
  } catch (error) {
    nameCache.set(normalized, normalized);
  }

  return normalized;
};

const fetchNamesInBatches = async (uuids, limit = 5) => {
  const unique = Array.from(new Set(uuids.filter(Boolean)));
  const results = new Map();
  let index = 0;

  const worker = async () => {
    while (index < unique.length) {
      const currentIndex = index;
      index += 1;
      const uuid = unique[currentIndex];
      const name = await resolveUuidName(uuid);
      results.set(uuid, name);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
};

const buildMetaRows = (entry, sellerName) => {
  const rows = [];
  const rawEntries = Object.entries(entry).filter(([key]) => key !== "item");

  for (const [key, value] of rawEntries) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    if (key.toLowerCase().includes("uuid")) continue;
    if (key.toLowerCase().includes("owner")) continue;

    rows.push({ label: key, value });
  }

  rows.unshift({ label: "Verkäufer", value: sellerName });
  return rows.slice(0, 6);
};

const getItemLabel = (entry) => {
  const item = entry.item ?? {};
  return (
    item.displayName ||
    item.name ||
    item.type ||
    entry.itemName ||
    entry.material ||
    "Unbekanntes Item"
  );
};

const renderAuctions = async (entries) => {
  const uuids = entries.map((entry) => entry.owner || entry.seller || entry.uuid || entry.playerUuid);
  updateStatus("Spielernamen werden geladen …");
  const nameMap = await fetchNamesInBatches(uuids);

  elements.grid.innerHTML = "";
  const fragment = document.createDocumentFragment();

  const renderChunk = (start) => {
    const slice = entries.slice(start, start + 40);
    slice.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "card";

      const sellerUuid = entry.owner || entry.seller || entry.uuid || entry.playerUuid;
      const sellerName = nameMap.get(sellerUuid) || sellerUuid || "Unbekannt";

      const title = getItemLabel(entry);
      const price = formatPrice(entry.price ?? entry.currentPrice ?? entry.startPrice);

      const item = entry.item ?? {};
      const amount = item.amount ?? entry.amount ?? "–";
      const metaRows = buildMetaRows(entry, sellerName);

      const metaHtml = metaRows
        .map(
          (row) =>
            `<span><strong>${row.label}</strong><span>${row.value}</span></span>`
        )
        .join("");

      card.innerHTML = `
        <div class="card-header">
          <div>
            <div class="badge">${item.rarity ?? "Auktion"}</div>
            <div class="card-title">${title}</div>
          </div>
          <div class="card-price">${price} $</div>
        </div>
        <div class="card-meta">
          <span><strong>Menge</strong><span>${amount}</span></span>
          ${metaHtml}
        </div>
      `;

      fragment.appendChild(card);
    });

    if (start + 40 < entries.length) {
      requestAnimationFrame(() => renderChunk(start + 40));
    } else {
      elements.grid.appendChild(fragment);
      updateStatus("");
    }
  };

  renderChunk(0);
};

const updateTimestamp = () => {
  const now = new Date();
  elements.lastUpdated.textContent = `Letztes Update: ${now.toLocaleString("de-DE")}`;
};

const applyFilter = () => {
  const query = elements.search.value.trim().toLowerCase();
  if (!query) {
    elements.count.textContent = `${auctions.length} Auktionen`;
    renderAuctions(auctions);
    return;
  }

  const filtered = auctions.filter((entry) =>
    JSON.stringify(entry).toLowerCase().includes(query)
  );
  elements.count.textContent = `${filtered.length} Auktionen`;
  renderAuctions(filtered);
};

const fetchAuctions = async () => {
  elements.refresh.disabled = true;
  updateStatus("Auktionen werden geladen …");

  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error(`API antwortet mit ${response.status}`);
    }
    const data = await response.json();
    auctions = Array.isArray(data) ? data : data?.auctions ?? [];

    elements.count.textContent = `${auctions.length} Auktionen`;
    updateTimestamp();

    if (!auctions.length) {
      elements.grid.innerHTML = `<div class="empty">Derzeit gibt es keine aktiven Auktionen.</div>`;
      updateStatus("");
    } else {
      renderAuctions(auctions);
    }
  } catch (error) {
    updateStatus(
      "Die Auktionsdaten konnten nicht geladen werden. Bitte später erneut versuchen.",
      "error"
    );
    elements.grid.innerHTML = "";
  } finally {
    elements.refresh.disabled = false;
  }
};

const init = () => {
  elements.refresh.addEventListener("click", fetchAuctions);
  elements.search.addEventListener("input", () => {
    window.clearTimeout(elements.search._debounce);
    elements.search._debounce = window.setTimeout(applyFilter, 250);
  });

  fetchAuctions();
};

init();
