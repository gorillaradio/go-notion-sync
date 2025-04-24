import dotenv from "dotenv";
import { Client } from "@notionhq/client";

dotenv.config();
console.log("🔄 Two-way sync script initializing...");
console.log("✔️ NOTION_TOKEN loaded:", !!process.env.NOTION_TOKEN);
console.log("📚 SOURCES DB IDs:", process.env.DATABASES_SRC);
console.log("🏠 HUB_DB ID:", process.env.DATABASE_HUB);
const notion = new Client({ auth: process.env.NOTION_TOKEN });

const SOURCES = JSON.parse(process.env.DATABASES_SRC);
const HUB_DB = process.env.DATABASE_HUB;

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

async function syncPageToHub(page) {
  const src = page.properties;
  const props = {};
  for (const [key, val] of Object.entries(src)) {
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
        if (val.multi_select.length) props[key] = { multi_select: val.multi_select };
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
    }
  }
  props.Source = { rich_text: [{ text: { content: page.id } }] };

  await notion.pages.create({
    parent: { database_id: HUB_DB },
    properties: props,
  });
  console.log(`→ Synced ${page.id}`);
}

async function updateHubPage(hubPageId, page) {
  const src = page.properties;
  const props = {};
  for (const [key, val] of Object.entries(src)) {
    if (key === "Source" || key === "Deleted") continue;
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
        if (val.multi_select.length) props[key] = { multi_select: val.multi_select };
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
    }
  }
  props.Source = { rich_text: [{ text: { content: page.id } }] };

  await notion.pages.update({
    page_id: hubPageId,
    properties: props,
  });
  console.log(`→ Updated Hub page ${hubPageId} for source ${page.id}`);
}

async function syncAll() {
  console.log("🔁 syncAll() called");

  console.log("🔃 Running reverse sync first to apply Hub changes to Source");
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

      // Use metadata timestamps
      const hubLastEdited   = hubPage.last_edited_time;
      const sourceLastEdited = sourcePage.last_edited_time;

      if (new Date(hubLastEdited) > new Date(sourceLastEdited)) {
        const src = hubPage.properties;
        const props = {};
        for (const [key, val] of Object.entries(src)) {
          if (key === "Source" || key === "Deleted") continue;
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
              if (val.multi_select.length) props[key] = { multi_select: val.multi_select };
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

      const sourceLastEdited = pg.last_edited_time;
      if (!hubPageId) {
        await syncPageToHub(pg);
      } else {
        const hubPage = await notion.pages.retrieve({ page_id: hubPageId });
        const hubLastEdited = hubPage.last_edited_time;
        // Compare metadata timestamps for forward updates
        if (new Date(sourceLastEdited) > new Date(hubLastEdited)) {
          await updateHubPage(hubPageId, pg);
        }
      }
    }
  }
  console.log("Sync completed.");
}

(async () => {
  try {
    await syncAll();
  } catch (e) {
    console.error("Error during sync:", e);
  }
})();
