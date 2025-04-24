import dotenv from "dotenv";
import { Client } from "@notionhq/client";

// 1) Carica le env vars da .env
dotenv.config();
console.log("🔄 Two-way sync script initializing...");
console.log("✔️ NOTION_TOKEN loaded:", !!process.env.NOTION_TOKEN);
console.log("📚 SOURCES DB IDs:", process.env.DATABASES_SRC);
console.log("🏠 HUB_DB ID:", process.env.DATABASE_HUB);
const notion = new Client({ auth: process.env.NOTION_TOKEN });

// 2) Estrai gli ID dei DB da .env
const SOURCES = JSON.parse(process.env.DATABASES_SRC);
const HUB_DB = process.env.DATABASE_HUB;

// 3) Funzione per prendere tutte le pagine da un DB sorgente
async function fetchTasks(dbId) {
  const pages = [];
  let cursor;
  do {
    const { results, next_cursor, has_more } = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
    });
    pages.push(...results);
    cursor = has_more ? next_cursor : undefined;
  } while (cursor);
  return pages;
}

// 4) Controlla se una pagina è già in Hub (proprietà Source uguale a page.id)
async function existsInHub(pageId) {
  const resp = await notion.databases.query({
    database_id: HUB_DB,
    filter: {
      property: "Source",
      rich_text: { contains: pageId },
    },
  });
  return resp.results.length > 0;
}

// In Hub, get the page ID of an already-synced task by its Source
async function getHubPageId(pageId) {
  const resp = await notion.databases.query({
    database_id: HUB_DB,
    filter: {
      property: "Source",
      rich_text: { contains: pageId },
    },
  });
  return resp.results[0]?.id || null;
}

// 5) Sincronizza una pagina nel DB Hub copiando tutte le proprietà supportate
async function syncPageToHub(page) {
  const src = page.properties;
  const sourceLastEdited = page.properties.Modificato.last_edited_time;
  const props = {};

  // Per ogni proprietà del sorgente
  for (const [key, val] of Object.entries(src)) {
    if (val.type === "title" && val.title.length) {
      props[key] = { title: val.title };
    } else if (val.type === "rich_text" && val.rich_text.length) {
      props[key] = { rich_text: val.rich_text };
    } else if (val.type === "select" && val.select) {
      props[key] = { select: { name: val.select.name } };
    } else if (val.type === "multi_select" && val.multi_select.length) {
      props[key] = { multi_select: val.multi_select };
    } else if (val.type === "date" && val.date) {
      props[key] = { date: { start: val.date.start } };
    } else if (val.type === "people" && val.people.length) {
      props[key] = { people: val.people };
    } else if (val.type === "checkbox") {
      props[key] = { checkbox: val.checkbox };
    } else if (val.type === "number" && val.number !== null) {
      props[key] = { number: val.number };
    } else if (val.type === "url" && val.url) {
      props[key] = { url: val.url };
    } else if (val.type === "email" && val.email) {
      props[key] = { email: val.email };
    } else if (val.type === "phone_number" && val.phone_number) {
      props[key] = { phone_number: val.phone_number };
    } else if (val.type === "files" && val.files.length) {
      props[key] = { files: val.files };
    }
    // Skip formula, rollup, created_time, last_edited_time
  }

  // Aggiungi sempre il campo Source con l’ID originale
  props.Source = { rich_text: [{ text: { content: page.id } }] };

  // Crea in Hub
  await notion.pages.create({
    parent: { database_id: HUB_DB },
    properties: props,
  });
  console.log(`→ Synced ${page.id}`);
}

// Update an existing Hub page with properties from the source page
async function updateHubPage(hubPageId, page) {
  const src = page.properties;
  const props = {};
  for (const [key, val] of Object.entries(src)) {
    // (repeat the same switch/case property handling as in syncPageToHub)
    switch (val.type) {
      case "title":
        if (val.title.length) props[key] = { title: val.title };
        break;
      case "rich_text":
        if (val.rich_text.length) props[key] = { rich_text: val.rich_text };
        break;
      case "select":
        if (val.select) props[key] = { select: { name: val.select.name } };
        break;
      case "multi_select":
        if (val.multi_select.length)
          props[key] = { multi_select: val.multi_select };
        break;
      case "date":
        if (val.date) props[key] = { date: { start: val.date.start } };
        break;
      case "people":
        if (val.people.length) props[key] = { people: val.people };
        break;
      case "checkbox":
        props[key] = { checkbox: val.checkbox };
        break;
      case "number":
        if (val.number !== null) props[key] = { number: val.number };
        break;
      case "url":
        if (val.url) props[key] = { url: val.url };
        break;
      case "email":
        if (val.email) props[key] = { email: val.email };
        break;
      case "phone_number":
        if (val.phone_number) props[key] = { phone_number: val.phone_number };
        break;
      case "files":
        if (val.files.length) props[key] = { files: val.files };
        break;
      // skip formula, rollup, created_time, last_edited_time
    }
  }
  // Always ensure Source remains
  props.Source = { rich_text: [{ text: { content: page.id } }] };

  await notion.pages.update({
    page_id: hubPageId,
    properties: props,
  });
  console.log(`→ Updated Hub page ${hubPageId} for source ${page.id}`);
}

// 6) Funzione principale: esegue una sync batch
async function syncAll() {
  console.log("🔁 syncAll() called");

  console.log("🔃 Running reverse sync first to apply Hub changes to Source");
  // Reverse sync from Hub back to Sources
  const hubPages = await fetchTasks(HUB_DB);
  console.log(`Found ${hubPages.length} pages in Hub for reverse sync`);
  for (const hubPage of hubPages) {
    console.log(`→ Reverse sync check for hub page: ${hubPage.id}`);
    const sourceProp = hubPage.properties.Source;
    if (!sourceProp || !sourceProp.rich_text.length) continue;
    const sourcePageId = sourceProp.rich_text[0].text.content;

    const hubDeleted = hubPage.properties.Deleted?.checkbox;
    if (hubDeleted) {
      await notion.pages.update({
        page_id: sourcePageId,
        properties: { Deleted: { checkbox: true } },
      });
      console.log(
        `→ Marked source page ${sourcePageId} as Deleted because Hub page ${hubPage.id} has Deleted flag`
      );
      continue;
    }

    try {
      const sourcePage = await notion.pages.retrieve({ page_id: sourcePageId });

      console.log(
        ">> Reverse sync action for hub page:",
        hubPage.id,
        "sourcePageId:",
        sourcePageId
      );

      const hubLastEdited = hubPage.properties.Modificato.last_edited_time;
      const sourceLastEdited =
        sourcePage.properties.Modificato.last_edited_time;

      if (new Date(hubLastEdited) > new Date(sourceLastEdited)) {
        // Reuse updateSourcePage logic inline without the deleted or archived checks
        const src = hubPage.properties;
        const props = {};
        for (const [key, val] of Object.entries(src)) {
          if (key === "Source" || key === "Deleted") continue;
          switch (val.type) {
            case "title":
              if (val.title.length) props[key] = { title: val.title };
              break;
            case "rich_text":
              if (val.rich_text.length)
                props[key] = { rich_text: val.rich_text };
              break;
            case "select":
              if (val.select)
                props[key] = { select: { name: val.select.name } };
              break;
            case "multi_select":
              if (val.multi_select.length)
                props[key] = { multi_select: val.multi_select };
              break;
            case "date":
              if (val.date) props[key] = { date: { start: val.date.start } };
              break;
            case "people":
              if (val.people.length) props[key] = { people: val.people };
              break;
            case "checkbox":
              props[key] = { checkbox: val.checkbox };
              break;
            case "number":
              if (val.number !== null) props[key] = { number: val.number };
              break;
            case "url":
              if (val.url) props[key] = { url: val.url };
              break;
            case "email":
              if (val.email) props[key] = { email: val.email };
              break;
            case "phone_number":
              if (val.phone_number)
                props[key] = { phone_number: val.phone_number };
              break;
            case "files":
              if (val.files.length) props[key] = { files: val.files };
              break;
            // skip formula, rollup, created_time, last_edited_time
          }
        }

        await notion.pages.update({
          page_id: sourcePageId,
          properties: props,
        });
        console.log(
          `→ Reverse synced Hub ${hubPage.id} to Source ${sourcePageId}`
        );
      }
    } catch (e) {
      console.error(
        `Error retrieving or updating source page ${sourcePageId}:`,
        e
      );
    }
  }

  console.log("➡️ Running forward sync to apply Source changes to Hub");
  for (const dbId of SOURCES) {
    const pages = await fetchTasks(dbId);
    console.log(`Found ${pages.length} pages in ${dbId}`);
    for (const pg of pages) {
      console.log(`→ Forward sync check for source page: ${pg.id}`);

      const deleted = pg.properties.Deleted?.checkbox;
      const sourceLastEdited = pg.properties.Modificato.last_edited_time;
      const hubPageId = await getHubPageId(pg.id);

      if (deleted) {
        console.log(
          `→ Skipping source page ${pg.id} because Deleted flag is true`
        );
        continue;
      }

      console.log(
        ">> Forward sync action for source page:",
        pg.id,
        "hubPageId:",
        hubPageId
      );

      if (!hubPageId) {
        await syncPageToHub(pg);
      } else {
        await updateHubPage(hubPageId, pg);
      }
    }
  }
  console.log("Sync completed.");
}

// 7) Avvia la sincronizzazione
(async () => {
  try {
    await syncAll();
  } catch (e) {
    console.error("Error during sync:", e);
  }
})();
