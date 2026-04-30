/**
 * Deletes all messages from every mailbox on an IMAP server.
 * Intended for resetting imap-target between test runs.
 *
 * Usage:
 *   npm run imap:clear
 *   IMAP_HOST=localhost IMAP_PORT=144 tsx scripts/clear-imap.ts
 */

import { ImapFlow } from "imapflow";

const HOST = process.env.IMAP_HOST ?? "localhost";
const PORT = Number(process.env.IMAP_PORT ?? 144);
const USER = process.env.IMAP_USER ?? "testuser";
const PASS = process.env.IMAP_PASS ?? "testpass";

const client = new ImapFlow({
  host: HOST,
  port: PORT,
  secure: false,
  auth: { user: USER, pass: PASS },
  logger: false,
});

await client.connect();

const mailboxes = await client.list();
let total = 0;

for (const mailbox of mailboxes) {
  const lock = await client.getMailboxLock(mailbox.path);
  try {
    const status = await client.status(mailbox.path, { messages: true });
    if (!status.messages || status.messages === 0) continue;

    await client.messageDelete("1:*", { uid: false });
    console.log(`  cleared ${status.messages} message(s) from ${mailbox.path}`);
    total += status.messages;
  } finally {
    lock.release();
  }
}

await client.logout();
console.log(`\nCleared ${total} message(s) total from ${HOST}:${PORT}.`);
