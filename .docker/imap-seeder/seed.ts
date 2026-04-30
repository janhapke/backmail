import { ImapFlow } from "imapflow";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const HOST = process.env.IMAP_HOST ?? "imap-source";
const PORT = Number(process.env.IMAP_PORT ?? 143);
const USER = process.env.IMAP_USER ?? "testuser";
const PASS = process.env.IMAP_PASS ?? "testpass";
const MAIL_DIR = process.env.MAIL_DIR ?? "/mails";

const FOLDER_MAP: Record<string, string> = {
  "inbox-": "INBOX",
  "sent-": "Sent",
  "archive-": "Archive",
};

function folderFor(filename: string): string {
  for (const [prefix, folder] of Object.entries(FOLDER_MAP)) {
    if (filename.startsWith(prefix)) return folder;
  }
  return "INBOX";
}

async function waitForImap(retries = 20, delayMs = 2000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    const client = new ImapFlow({
      host: HOST,
      port: PORT,
      secure: false,
      auth: { user: USER, pass: PASS },
      logger: false,
    });
    try {
      await client.connect();
      await client.logout();
      console.log(`IMAP ready after ${(i * delayMs) / 1000}s`);
      return;
    } catch {
      console.log(`Waiting for IMAP (${i + 1}/${retries})...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.error("IMAP never became ready");
  process.exit(1);
}

async function ensureFolder(client: ImapFlow, folder: string): Promise<void> {
  const mailboxes = await client.list();
  const exists = mailboxes.some((m) => m.path === folder);
  if (!exists) {
    await client.mailboxCreate(folder);
  }
}

async function main() {
  await waitForImap();

  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    auth: { user: USER, pass: PASS },
    logger: false,
  });

  await client.connect();

  const folders = [...new Set(Object.values(FOLDER_MAP))];
  for (const folder of folders) {
    await ensureFolder(client, folder);
  }

  const files = (await readdir(MAIL_DIR))
    .filter((f) => f.endsWith(".eml"))
    .sort();

  if (files.length === 0) {
    console.log("No .eml files found in", MAIL_DIR);
    await client.logout();
    return;
  }

  for (const file of files) {
    const folder = folderFor(file);
    const content = await readFile(join(MAIL_DIR, file));
    await client.append(folder, content);
    console.log(`  -> ${folder}: ${file}`);
  }

  await client.logout();
  console.log(`\nSeeded ${files.length} messages.`);
}

main();
