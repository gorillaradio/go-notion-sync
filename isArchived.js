import dotenv from "dotenv";
import { Client } from "@notionhq/client";

dotenv.config();
const notion = new Client({ auth: process.env.NOTION_TOKEN });

(async () => {
  const pageId = "1debb095-1485-80c9-9167-ec9f06ae2de7"; // metti qui l'ID corretto
  const page = await notion.pages.retrieve({ page_id: pageId });
  console.log("All property keys:", Object.keys(page.properties));
  const titlePropKey = Object.entries(page.properties).find(
    ([key, prop]) => prop.type === "title"
  )[0];
  console.log("Titolo:", page.properties[titlePropKey].title[0].plain_text);
  console.log("Archived flag:", page.archived);
})();
