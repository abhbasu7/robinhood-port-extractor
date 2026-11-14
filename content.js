(() => {
  const holdingHeaders = /\b(shares?|quantity|units|contracts?|average cost|avg\.? cost|cost basis|market value|total value|equity|holdings?)\b/i;
  const visibilityCache = new WeakMap();
  const textCache = new WeakMap();
  const visible = element => {
    if (!visibilityCache.has(element)) {
      visibilityCache.set(element, element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility === "visible");
    }
    return visibilityCache.get(element);
  };
  const read = element => {
    if (!textCache.has(element)) {
      textCache.set(element, (element.innerText ?? "").replace(/\s+/g, " ").trim());
    }
    return textCache.get(element);
  };
  const ignored = "svg, img, [aria-hidden='true']";
  const tables = [];
  const seen = new Set();
  let nextTableNumber = 1;

  function defaultHeaders(count) {
    return Array.from({ length: count }, (_, index) => "Column " + (index + 1));
  }

  function isHeaderRow(element) {
    return Boolean(element.querySelector("th, [role='columnheader']")) ||
      /header|heading|column-label/i.test(element.className?.toString() ?? "");
  }

  function addTable(name, headers, rows, key) {
    if (!rows.length || !headers.length || (key && seen.has(key))) return;
    if (key) seen.add(key);
    tables.push({ name, headers, rows, kind: "table" });
  }

  function normalizeRows(name, rowElements, rowValues, key) {
    if (!rowValues.length) return;
    let headers = defaultHeaders(rowValues[0].length);
    let dataRows = rowValues;
    if (isHeaderRow(rowElements[0])) {
      headers = rowValues[0].map((value, index) => value || headers[index]);
      dataRows = rowValues.slice(1);
    }
    dataRows = dataRows.filter(row => row.some(Boolean));
    addTable(name, headers, dataRows, key);
  }

  function tableName(element, fallback) {
    const ariaLabel = element.getAttribute("aria-label");
    const caption = element.querySelector(":scope > caption");
    const heading = element.querySelector("caption, h1, h2, h3, h4, h5, h6");
    return (ariaLabel || (caption && read(caption)) || (heading && read(heading)) || fallback)
      .slice(0, 100);
  }

  for (const table of document.querySelectorAll("table")) {
    const rows = Array.from(table.rows).filter(visible);
    const rowValues = rows.map(row =>
      Array.from(row.querySelectorAll(":scope > th, :scope > td")).filter(visible).map(read));
    const consistent = rowValues.filter(values => values.length >= 2 &&
      values.filter(Boolean).length >= 2);
    if (consistent.length < 2) continue;
    const width = Math.max(...consistent.map(values => values.length));
    const selectedRows = rows.filter((_, index) =>
      rowValues[index].length === width && rowValues[index].filter(Boolean).length >= 2);
    const selectedValues = selectedRows.map(row =>
      Array.from(row.querySelectorAll(":scope > th, :scope > td")).filter(visible).map(read));
    normalizeRows(
      tableName(table, "Table " + nextTableNumber++),
      selectedRows,
      selectedValues,
      "semantic:" + Array.from(table.rows).map(row => read(row)).join("\u001f")
    );
  }

  for (const table of document.querySelectorAll("[role='table'], [role='grid'], [role='treegrid']")) {
    const rows = Array.from(table.querySelectorAll("[role='row']")).filter(row =>
      row.closest("[role='table'], [role='grid'], [role='treegrid']") === table && visible(row));
    const rowCells = rows.map(row => Array.from(row.querySelectorAll(
      "[role='columnheader'], [role='gridcell'], [role='rowheader'], [role='cell']"
    )).filter(cell => cell.closest("[role='row']") === row && visible(cell)));
    const values = rowCells.map(cells => cells.map(read));
    const width = Math.max(0, ...values.map(row => row.length));
    const selected = rows.map((row, index) => ({ row, values: values[index] }))
      .filter(item => item.values.length === width && item.values.length >= 2 &&
        item.values.filter(Boolean).length >= 2);
    if (selected.length < 2) continue;
    normalizeRows(
      tableName(table, "Table " + nextTableNumber++),
      selected.map(item => item.row),
      selected.map(item => item.values),
      "aria:" + selected.map(item => item.values.join("\u001e")).join("\u001f")
    );
  }

  function rowCells(row) {
    let current = row;
    while (true) {
      const children = Array.from(current.children).filter(child =>
        !child.matches(ignored) && visible(child));
      if (children.length !== 1) return children.length >= 2 ? children.map(read) : [];
      current = children[0];
    }
  }

  for (const parent of document.body.querySelectorAll("*")) {
    if (parent.children.length < 2 ||
        parent.closest("table, [role='table'], [role='grid'], [role='treegrid']")) continue;
    const children = Array.from(parent.children).filter(child =>
      !child.matches(ignored) && visible(child));
    if (children.length < 2) continue;
    const candidates = children.map(row => ({ row, values: rowCells(row) }))
      .filter(item => item.values.length >= 2 && item.values.filter(Boolean).length >= 2);
    if (candidates.length < 2) continue;

    const counts = new Map();
    for (const item of candidates) {
      counts.set(item.values.length, (counts.get(item.values.length) ?? 0) + 1);
    }
    const width = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
    const selected = candidates.filter(item => item.values.length === width);
    if (selected.length < 2) continue;

    const key = "generic:" + selected.map(item => JSON.stringify(item.values)).join("\u001f");
    normalizeRows(
      tableName(parent, "Table " + nextTableNumber++),
      selected.map(item => item.row),
      selected.map(item => item.values),
      key
    );
  }

  // Keep the Robinhood-specific detector for layouts that expose links but no table semantics.
  const legacyHeaders = [
    "Name", "Symbol", "Shares", "Price",
    "Average cost", "Total return", "Equity"
  ];
  const legacyCell = ".qVizNsgJursdUUgiZtoQzg--";
  function legacyCells(element) {
    const children = Array.from(element.children).filter(child =>
      !child.matches(ignored) && visible(child));
    return children.length === 1 ? legacyCells(children[0]) : children.map(read);
  }

  function getHoldingHeaders(element) {
    const labels = legacyCells(element);
    return labels.length >= 2 && labels.every(Boolean) && labels.some(label =>
      holdingHeaders.test(label)) && labels.some(label =>
      /^(name|symbol|ticker|asset|security|investment|stock|crypto|price|current price|market price)s?$/i.test(label))
      ? labels : null;
  }

  const holdingGroups = new Map();
  const consumed = new Set();
  for (const link of document.querySelectorAll("a[href]")) {
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin ||
        !/^\/(stocks|crypto|options)\/[^/]+\/?$/.test(url.pathname) || !visible(link)) continue;

    let row = link;
    let match;
    for (let depth = 0; row?.parentElement && depth < 6; depth++, row = row.parentElement) {
      const values = legacyCells(row);
      if (values.length < 2 || row.querySelectorAll("a[href]").length > 1) continue;

      let container = row;
      for (let level = 0; container?.parentElement && level < 3 && !match; level++, container = container.parentElement) {
        for (let sibling = container.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
          if (!visible(sibling)) continue;
          const labels = getHoldingHeaders(sibling);
          if (labels && labels.length === values.length) {
            match = { row, headers: labels, values };
            break;
          }
        }
      }
      if (match) break;
    }

    if (!match) {
      const values = Array.from(link.querySelectorAll(legacyCell)).filter(visible).map(read);
      if (values.length === legacyHeaders.length) {
        match = { row: link, headers: legacyHeaders, values };
      }
    }

    if (!match || consumed.has(match.row) || !match.values.some(Boolean)) continue;
    consumed.add(match.row);
    const key = JSON.stringify(match.headers.map(label => label.toLowerCase()));
    if (!holdingGroups.has(key)) holdingGroups.set(key, { headers: match.headers, rows: [] });
    holdingGroups.get(key).rows.push(match.values);
  }

  const holdingHeadersOut = [];
  const holdingRows = [];
  for (const group of holdingGroups.values()) {
    const used = new Set();
    const columns = group.headers.map(label => {
      let index = holdingHeadersOut.findIndex((header, i) =>
        !used.has(i) && header.toLowerCase() === label.toLowerCase());
      if (index === -1) index = holdingHeadersOut.push(label) - 1;
      used.add(index);
      return index;
    });
    for (const values of group.rows) {
      const output = [];
      columns.forEach((column, index) => { output[column] = values[index]; });
      holdingRows.push(output);
    }
  }
  if (holdingRows.length) {
    addTable(
      "Robinhood holdings",
      holdingHeadersOut,
      holdingRows.map(row => holdingHeadersOut.map((_, index) => row[index] ?? "")),
      "robinhood-holdings"
    );
  }

  return { tables };
})();
