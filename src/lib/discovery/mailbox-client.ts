import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { htmlToText, parseHTML } from './html';

export interface ParsedMailMessage {
  messageId: string;
  text: string;
}

/**
 * The plaintext body to use, given what `simpleParser` returned. Prefers its
 * `text` — present for an explicit `text/plain` part, and mailparser also
 * derives one from `html` on its own for an ordinary HTML-only message — and
 * falls back to this project's own `htmlToText` only for the residual case
 * where mailparser leaves `text` unset despite `html` being present (e.g.
 * markup its own converter can't handle), per docs/discovery-agent.md's
 * *Mailing lists* section: "Attachments and HTML parts are not fetched or
 * rendered; take `text/plain` and fall back to stripped HTML." Exported
 * separately so that residual case is directly testable without depending
 * on mailparser's own conversion failing.
 */
export function textFromParsed(parsed: Pick<ParsedMail, 'text' | 'html'>): string {
  return parsed.text?.trim() || (parsed.html ? htmlToText(parseHTML(parsed.html)) : '');
}

/**
 * Pure MIME parsing — no network. A message the pipeline cannot durably
 * identify (no `Message-ID`) or that carries no readable body is skipped,
 * same as every other parser in this directory skips unusable input rather
 * than throwing.
 */
export async function parseMailMessage(
  raw: Buffer | string,
): Promise<ParsedMailMessage | undefined> {
  const parsed = await simpleParser(raw);
  if (!parsed.messageId) return undefined;
  const body = textFromParsed(parsed);
  if (!body) return undefined;
  const subject = parsed.subject?.trim();
  return { messageId: parsed.messageId, text: subject ? `${subject}\n\n${body}` : body };
}

export interface MailboxCredentials {
  host: string;
  port?: number;
  secure?: boolean;
  user: string;
  password: string;
}

/**
 * Connects read-only and fetches every message in `folder` not already
 * known to `alreadySeen`. Two passes keep this cheap on a mailing list with
 * years of history: the first fetches only UID + envelope (no bodies) to
 * find which Message-IDs are new, the second fetches full source for just
 * those UIDs. Message-ID is the only durable key used — no IMAP-side
 * high-water mark (UID, UIDVALIDITY) is tracked, so a server-side UID reset
 * costs one extra full-envelope pass, never a duplicate or a miss.
 *
 * Never sends, replies, deletes or marks anything, per this project's
 * security model for mailing-list ingestion.
 */
export async function fetchNewMailboxMessages(
  credentials: MailboxCredentials,
  folder: string,
  alreadySeen: (messageId: string) => boolean,
): Promise<ParsedMailMessage[]> {
  const client = new ImapFlow({
    host: credentials.host,
    port: credentials.port ?? 993,
    secure: credentials.secure ?? true,
    auth: { user: credentials.user, pass: credentials.password },
    logger: false,
  });

  // imapflow emits connection-level failures (e.g. a dropped socket) as an
  // `error` event on the client, separately from rejecting whatever
  // promise was in flight — observed live: a rejected `connect()` (bad
  // auth) was correctly caught below, and then a *second*, unrelated
  // ECONNRESET during cleanup crashed the whole process anyway, because
  // nothing was listening. Node's default behavior for an unhandled
  // EventEmitter `error` event is to throw and kill the process — which
  // would take an entire cron run down over one flaky mailbox connection.
  // Every real failure path here already surfaces through an awaited
  // promise rejection (connect/fetch/getMailboxLock all throw normally),
  // so this listener only exists to stop that redundant event from
  // reaching Node's default handler; it deliberately does nothing else.
  client.on('error', () => {});

  try {
    // `connect()` throws on either a connection *or* an authentication
    // failure (imapflow's own contract) — it must be inside this try, not
    // before it, or a bad-credentials run never reaches the cleanup below
    // at all. Observed live: with `connect()` outside the try, a failed
    // login left the TCP socket open and the whole process hanging
    // (never exiting) until an external timeout killed it.
    await client.connect();
    const lock = await client.getMailboxLock(folder, { readOnly: true });
    try {
      const newUids: number[] = [];
      for await (const message of client.fetch('1:*', { uid: true, envelope: true })) {
        const messageId = message.envelope?.messageId;
        if (messageId && !alreadySeen(messageId)) newUids.push(message.uid);
      }

      const messages: ParsedMailMessage[] = [];
      if (newUids.length > 0) {
        // The third argument's `uid: true` is what tells imapflow that
        // `newUids` (collected as UIDs above) are UIDs, not sequence
        // numbers — distinct from the second argument's `uid: true`, which
        // only asks for the UID to be included in each response object.
        for await (const message of client.fetch(
          newUids,
          { uid: true, source: true },
          { uid: true },
        )) {
          if (!message.source) continue;
          const parsed = await parseMailMessage(message.source);
          if (parsed) messages.push(parsed);
        }
      }
      return messages;
    } finally {
      lock.release();
    }
  } finally {
    // `close()`, not `logout()`: `logout()` sends a graceful LOGOUT
    // command over an authenticated session, which may not exist here —
    // `connect()` can fail before one ever does. `close()` unconditionally
    // and synchronously tears down the TCP connection regardless of what
    // stage failed, which is what actually stops a bad-credentials or
    // dropped-connection run from hanging forever (see the comment above).
    try {
      client.close();
    } catch {
      // Best-effort cleanup — nothing more to do if even this fails.
    }
  }
}
