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

// Fetch all pages from a database
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

// Get the Hub page ID corresponding to a source page
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

// Map properties generically from a page
function mapProperties(srcProps) {
  const props = {};
  for (const [key, val] of Object.entries(srcProps)) {
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
      // skip formula, rollup, created_time, last_edited_time
    }
  }
  return props;
}

// Create a new page in Hub
async function syncPageToHub(page) {
  const props = mapProperties(page.properties);
  props.Source = { rich_text: [{ text: { content: page.id } }] };
  await notion.pages.create({ parent: { database_id: HUB_DB }, properties: props });
  console.log(`→ Created Hub page for source ${page.id}`);
}

// Update an existing Hub page
async function updateHubPage(hubPageId, page) {
  const props = mapProperties(page.properties);
  props.Source = { rich_text: [{ text: { content: page.id } }] };
  await notion.pages.update({ page_id: hubPageId, properties: props });
  console.log(`→ Updated Hub page ${hubPageId} for source ${page.id}`);
}

// Update the source page properties
async function updateSourcePage(sourcePageId, hubPage) {
  const props = mapProperties(hubPage.properties);
  // Preserve Source and Deleted in Hub, skip them here
  delete props.Source;
  delete props.Deleted;
  await notion.pages.update({ page_id: sourcePageId, properties: props });
  console.log(`→ Updated Source page ${sourcePageId} from Hub ${hubPage.id}`);
}

// Main sync function
async function syncAll() {
  console.log("🔁 syncAll() called");

  // Reverse sync: Hub -> Source
  console.log("🔃 Running reverse sync from Hub to Source");
  const hubPages = await fetchTasks(HUB_DB);
  for (const hubPage of hubPages) {
    const sourceProp = hubPage.properties.Source;
    if (!sourceProp?.rich_text.length) continue;
    const sourcePageId = sourceProp.rich_text[0].text.content;
    const hubDeleted = hubPage.properties.Deleted?.checkbox;

    if (hubDeleted) {
      await notion.pages.update({ page_id: sourcePageId, properties: { Deleted: { checkbox: true } } });
      console.log(`→ Marked Source ${sourcePageId} Deleted (from Hub ${hubPage.id})`);
      continue;
    }

    const hubLastEdited = new Date(hubPage.last_edited_time);
    const sourcePage = await notion.pages.retrieve({ page_id: sourcePageId });
    const sourceLastEdited = new Date(sourcePage.last_edited_time);

    if (hubLastEdited > sourceLastEdited) {
      await updateSourcePage(sourcePageId, hubPage);
    }
  }

  // Forward sync: Source -> Hub
  console.log("➡️ Running forward sync from Source to Hub");
  for (const dbId of SOURCES) {
    const pages = await fetchTasks(dbId);
    for (const page of pages) {
      const deleted = page.properties.Deleted?.checkbox;
      if (deleted) continue;
      const hubPageId = await getHubPageId(page.id);
      const sourceLastEdited = new Date(page.last_edited_time);

      if (!hubPageId) {
        await syncPageToHub(page);
      } else {
        const hubPage = await notion.pages.retrieve({ page_id: hubPageId });
        const hubLastEdited = new Date(hubPage.last_edited_time);

        if (sourceLastEdited > hubLastEdited) {
          await updateHubPage(hubPageId, page);
        }
      }
    }
  }

  console.log("Sync completed.");
}

// Execute
(async () => {
  try {
    await syncAll();
  } catch (e) {
    console.error("Error during sync:", e);
  }
})();
