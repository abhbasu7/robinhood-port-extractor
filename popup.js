const scanButton = document.getElementById("scanBtn");
const tableSelect = document.getElementById("tableSelect");
const tableLabel = document.getElementById("tableLabel");
const exportButton = document.getElementById("exportBtn");
const status = document.getElementById("status");
let detectedTables = [];

scanButton.addEventListener("click", async () => {
  scanButton.disabled = true;
  tableSelect.hidden = true;
  tableLabel.hidden = true;
  exportButton.hidden = true;
  detectedTables = [];
  status.textContent = "Scanning visible page data…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ? new URL(tab.url) : null;
    if (!tab?.id || !url || !["http:", "https:"].includes(url.protocol)) {
      status.textContent = "Open a website page, then try again.";
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    detectedTables = result?.tables ?? [];
    if (!detectedTables.length) {
      status.textContent = "No table-like data found. Some custom or unloaded page layouts may not be detectable.";
      return;
    }

    tableSelect.replaceChildren(...detectedTables.map((table, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${table.name} (${table.rows.length} rows, ${table.headers.length} columns)`;
      return option;
    }));
    tableSelect.hidden = false;
    tableLabel.hidden = false;
    exportButton.hidden = false;
    status.textContent = detectedTables.length === 1
      ? "1 table found. Confirm the selection and download."
      : `${detectedTables.length} tables found. Choose one to export.`;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    status.textContent = "Couldn’t scan this page: " + details;
  } finally {
    scanButton.disabled = false;
  }
});

exportButton.addEventListener("click", () => {
  const index = Number(tableSelect.value);
  const table = detectedTables[index];
  if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) {
    status.textContent = "Choose a detected table before exporting.";
    return;
  }

  const csv = [table.headers, ...table.rows].map(row => row.map(value => {
    const text = String(value ?? "");
    const signedNumber = /^[+-]\s*[$€£]?\s*\d[\d,.]*(?:\s*%)?$/.test(text);
    const safe = /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(text) && !signedNumber
      ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  }).join(",")).join("\r\n");

  const objectUrl = URL.createObjectURL(new Blob(["\uFEFF", csv], {
    type: "text/csv;charset=utf-8"
  }));
  const link = document.createElement("a");
  link.href = objectUrl;
  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map(part => String(part).padStart(2, "0")).join("-");
  const filename = table.name === "Robinhood holdings"
    ? "robinhood_holdings_" + date + ".csv"
    : "page_data_" + date + ".csv";
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  status.textContent = "CSV download started for " + table.rows.length + " rows.";
});
